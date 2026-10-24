"""Real LLM client for OpenAI-compatible chat completion APIs.

Works with OpenAI itself and with providers that speak the same API, such as
DeepSeek (``https://api.deepseek.com``). The ``openai`` SDK is imported lazily
so that importing this module never requires the package to be installed.
Constructing :class:`OpenAIClient` raises a clear error if the SDK is missing
or no API key is configured.
"""

from __future__ import annotations

import os
from typing import NamedTuple

from .base import LLMClient


class Provider(NamedTuple):
    base_url: str | None
    api_key_env: str
    default_model: str


# OpenAI-compatible providers, selected with FRONTROW_LLM.
PROVIDERS: dict[str, Provider] = {
    "openai": Provider(None, "OPENAI_API_KEY", "gpt-4o-mini"),
    "deepseek": Provider("https://api.deepseek.com", "DEEPSEEK_API_KEY", "deepseek-flash"),
}


class OpenAIClient(LLMClient):
    """An :class:`LLMClient` that calls an OpenAI-compatible chat completions API."""

    def __init__(self, api_key: str | None = None, provider: str = "openai") -> None:
        base_url, key_env, _ = PROVIDERS[provider]
        try:
            from openai import AsyncOpenAI  # lazy import
        except ImportError as exc:  # pragma: no cover - env dependent
            raise RuntimeError(
                "The 'openai' package is not installed. Install the optional "
                "dependency: uv sync --extra openai"
            ) from exc

        key = api_key or os.environ.get(key_env)
        if not key:
            raise RuntimeError(
                f"{key_env} is not set. Provide an api_key or set the "
                f"environment variable to use the {provider} client."
            )
        self._client = AsyncOpenAI(api_key=key, base_url=base_url)

    async def complete(
        self, system: str, user: str, *, model: str, timeout: float
    ) -> str:
        response = await self._client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            # Reaction prompts ask for a JSON object; JSON mode guarantees the
            # reply parses instead of arriving wrapped in prose or fences.
            response_format={"type": "json_object"},
            # Replies are a few short fields; the cap also stops a runaway
            # reply from being cut off mid-JSON (DeepSeek's recommendation).
            max_tokens=400,
            timeout=timeout,
        )
        content = response.choices[0].message.content
        return content or ""
