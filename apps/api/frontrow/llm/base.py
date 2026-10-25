"""LLM client interface.

All model access in FrontRow goes through :class:`LLMClient` so that the
deterministic :class:`~frontrow.llm.fake.FakeLLM` can be swapped in for tests
and replay, and act as a fallback when a real client fails.
"""

from __future__ import annotations

import abc
import json
import re
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from collections.abc import Callable, Iterator
from typing import Any

# Matches the first balanced-ish JSON object. We intentionally keep this simple
# and tolerant: find the first "{" and the last "}" and try to parse.
_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


LLMObserver = Callable[[dict[str, Any]], None]


@dataclass(frozen=True)
class LLMCall:
    tier: str = "fast"
    role: str = "unspecified"
    observer: LLMObserver | None = None


_call: ContextVar[LLMCall] = ContextVar("frontrow_llm_call", default=LLMCall())
llm_logger = logging.getLogger("frontrow.llm")
if not llm_logger.handlers:
    llm_logger.addHandler(logging.StreamHandler())
llm_logger.setLevel(logging.INFO)
llm_logger.propagate = False


def current_llm_call() -> LLMCall:
    return _call.get()


@contextmanager
def llm_call_context(tier: str, role: str, observer: LLMObserver | None = None) -> Iterator[None]:
    """Attach request metadata without changing the injected client interface."""
    inherited = current_llm_call()
    token = _call.set(LLMCall(tier, role, observer if observer is not None else inherited.observer))
    try:
        yield
    finally:
        _call.reset(token)


def emit_llm_event(kind: str, **data: Any) -> None:
    """Emit redacted request/fallback metadata; never log prompts or responses."""
    context = current_llm_call()
    event = {**data, "kind": kind, "tier": context.tier, "role": context.role}
    if kind == "fallback":
        llm_logger.warning("llm_fallback provider=%s model=%s tier=%s role=%s reason=%s",
                           data.get("provider", "unknown"), data.get("model", "unknown"),
                           context.tier, context.role, data.get("reason", "unknown"))
    elif kind == "request":
        usage = data.get("usage") or {}
        llm_logger.info("llm_request provider=%s model=%s tier=%s role=%s outcome=%s latency_ms=%.1f input_tokens=%s output_tokens=%s",
                        data.get("provider"), data.get("model"), context.tier, context.role,
                        data.get("outcome"), 1000 * data.get("latency_seconds", 0),
                        usage.get("prompt_tokens"), usage.get("completion_tokens"))
    if context.observer is not None:
        try:
            context.observer(event)
        except Exception:  # Telemetry must never change an answer or trigger fallback.
            llm_logger.warning("llm_observer_failed tier=%s role=%s", context.tier, context.role)


class LLMClient(abc.ABC):
    """Abstract base for producing model completions."""

    @abc.abstractmethod
    async def complete(
        self, system: str, user: str, *, model: str, timeout: float
    ) -> str:
        """Return the raw text completion for ``system`` + ``user`` prompts."""
        raise NotImplementedError

    async def complete_json(
        self, system: str, user: str, *, model: str, timeout: float
    ) -> dict[str, Any]:
        """Return a parsed JSON object extracted from the completion.

        Tolerant: extracts the first ``{...}`` block from the raw text and
        parses it. Raises ``ValueError`` if no JSON object can be found.
        """
        raw = await self.complete(system, user, model=model, timeout=timeout)
        return parse_json_object(raw)


def parse_json_object(raw: str) -> dict[str, Any]:
    """Extract and parse the first JSON object found in ``raw`` text."""
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            return parsed
    except (json.JSONDecodeError, TypeError):
        pass
    match = _JSON_OBJECT_RE.search(raw)
    if not match:
        raise ValueError(f"no JSON object found in LLM response: {raw!r}")
    return json.loads(match.group(0))
