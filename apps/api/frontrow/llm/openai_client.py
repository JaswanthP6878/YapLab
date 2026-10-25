"""Real LLM client for OpenAI-compatible chat completion APIs.

Works with OpenAI itself and with providers that speak the same API, such as
DeepSeek and Nebius Token Factory. The ``openai`` SDK is imported lazily
so that importing this module never requires the package to be installed.
Constructing :class:`OpenAIClient` raises a clear error if the SDK is missing
or no API key is configured.
"""

from __future__ import annotations

import asyncio
import os
import re
from copy import deepcopy
from time import perf_counter
from typing import Any, NamedTuple

from .base import LLMClient, current_llm_call, emit_llm_event


class Provider(NamedTuple):
    base_url: str | None
    api_key_env: str
    default_model: str
    default_reasoning_model: str | None = None
    request_extras: dict[str, Any] | None = None
    reasoning_extras: dict[str, Any] | None = None
    reasoning_max_tokens: int | None = None


# OpenAI-compatible providers, selected with FRONTROW_LLM.
PROVIDERS: dict[str, Provider] = {
    "openai": Provider(None, "OPENAI_API_KEY", "gpt-4o-mini"),
    "deepseek": Provider("https://api.deepseek.com", "DEEPSEEK_API_KEY", "deepseek-flash"),
    "nebius": Provider(
        "https://api.tokenfactory.nebius.com/v1/",
        "NEBIUS_API_KEY",
        "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
        default_reasoning_model="nvidia/Nemotron-3-Ultra-550b-a55b",
        request_extras={"chat_template_kwargs": {"enable_thinking": False}},
        reasoning_extras={"chat_template_kwargs": {"enable_thinking": True}},
        reasoning_max_tokens=4096,
    ),
}

_CLOSED_THINK = re.compile(r"<think\s*>.*?</think\s*>", re.IGNORECASE | re.DOTALL)
_OPEN_THINK = re.compile(r"<think\s*>.*$", re.IGNORECASE | re.DOTALL)
_END_THINK = re.compile(r"</think\s*>", re.IGNORECASE)


def _strip_thinking(content: str) -> str:
    """Remove inline reasoning, including a trace cut off before its close tag."""
    content = _CLOSED_THINK.sub("", content)
    # Some templates supply the opening tag, so only its closing marker is returned.
    endings = list(_END_THINK.finditer(content))
    if endings:
        content = content[endings[-1].end():]
    return _OPEN_THINK.sub("", content).strip()


def _usage_dict(usage: Any) -> dict[str, Any] | None:
    if isinstance(usage, dict):
        return dict(usage)
    dump = getattr(usage, "model_dump", None)
    return dump() if callable(dump) else None


class OpenAIClient(LLMClient):
    """An :class:`LLMClient` that calls an OpenAI-compatible chat completions API."""

    def __init__(self, api_key: str | None = None, provider: str = "openai") -> None:
        selected = PROVIDERS[provider]
        try:
            from openai import AsyncOpenAI  # lazy import
        except ImportError as exc:  # pragma: no cover - env dependent
            raise RuntimeError(
                "The 'openai' package is not installed. Install the optional "
                "dependency: uv sync --extra openai"
            ) from exc

        key = api_key or os.environ.get(selected.api_key_env)
        if not key:
            raise RuntimeError(
                f"{selected.api_key_env} is not set. Provide an api_key or set the "
                f"environment variable to use the {provider} client."
            )
        client_options: dict[str, Any] = {"api_key": key, "base_url": selected.base_url}
        if provider == "nebius":
            # Retries must not silently consume the room's per-listener deadline.
            client_options["max_retries"] = 0
        self._client = AsyncOpenAI(**client_options)
        self.provider_name = provider
        self._provider = selected
        self._closed = False

    async def aclose(self) -> None:
        """Release the SDK's pooled HTTP client once requests have stopped."""
        if not self._closed:
            await self._client.close()
            self._closed = True

    async def complete(
        self, system: str, user: str, *, model: str, timeout: float
    ) -> str:
        request: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            # JSON mode still requires schema validation by the caller.
            "response_format": {"type": "json_object"},
            "max_tokens": 400,
            "timeout": timeout,
        }
        extras = self._provider.request_extras
        if self.provider_name == "nebius" and current_llm_call().tier == "reasoning":
            extras = self._provider.reasoning_extras
            request["max_tokens"] = self._provider.reasoning_max_tokens or 400
        if extras is not None:
            request["extra_body"] = deepcopy(extras)

        started = perf_counter()
        usage = None
        finish_reason = None
        outcome = "error"
        error_type = None
        try:
            response = await self._client.chat.completions.create(**request)
            # Record billing before downstream content parsing/schema validation.
            usage = _usage_dict(getattr(response, "usage", None))
            choice = response.choices[0]
            reason = getattr(choice, "finish_reason", None)
            finish_reason = str(reason) if reason is not None else None
            content = choice.message.content or ""
            if self.provider_name == "nebius":
                content = _strip_thinking(content)
            outcome = "success"
            return content
        except asyncio.CancelledError:
            outcome = "cancelled"
            error_type = "CancelledError"
            raise
        except Exception as exc:
            error_type = type(exc).__name__
            raise
        finally:
            emit_llm_event(
                "request",
                provider=self.provider_name,
                model=model,
                latency_seconds=perf_counter() - started,
                usage=usage,
                finish_reason=finish_reason,
                outcome=outcome,
                error_type=error_type,
            )
