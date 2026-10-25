"""Fallback wrapper: degrade to the deterministic FakeLLM on failure.

:class:`FallbackLLM` wraps a primary (real) client. If the primary raises,
returns output that cannot be parsed as a JSON object, or does not respond
within ``timeout`` seconds, the request is answered by the fallback client
instead and reported through ``on_fallback`` so the caller can record it.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

from .base import LLMClient, emit_llm_event
from .fake import FakeLLM

FallbackHook = Callable[[str], None]


class FallbackLLM(LLMClient):
    """An :class:`LLMClient` that falls back to another client on failure."""

    def __init__(
        self,
        primary: LLMClient,
        fallback: LLMClient | None = None,
        on_fallback: FallbackHook | None = None,
    ) -> None:
        self.primary = primary
        self.fallback = fallback or FakeLLM()
        # Called with a short reason string each time a request falls back.
        self.on_fallback = on_fallback
        self.fallback_count = 0
        self._closed_clients: set[int] = set()

    async def aclose(self) -> None:
        """Close optional provider resources, including a real fallback."""
        for client in (self.primary, self.fallback):
            if id(client) in self._closed_clients:
                continue
            close = getattr(client, "aclose", None)
            if callable(close):
                await close()
            self._closed_clients.add(id(client))

    def _note(self, reason: str, model: str) -> None:
        self.fallback_count += 1
        emit_llm_event("fallback", provider=getattr(self.primary, "provider_name", type(self.primary).__name__), model=model, reason=reason)
        if self.on_fallback is not None:
            self.on_fallback(reason)

    async def complete(
        self, system: str, user: str, *, model: str, timeout: float
    ) -> str:
        try:
            return await asyncio.wait_for(
                self.primary.complete(system, user, model=model, timeout=timeout),
                timeout,
            )
        except asyncio.TimeoutError:
            self._note("timeout", model)
        except Exception as exc:  # noqa: BLE001 - any primary failure falls back
            self._note(f"error: {type(exc).__name__}", model)
        return await self.fallback.complete(
            system, user, model=model, timeout=timeout
        )

    async def complete_json(
        self, system: str, user: str, *, model: str, timeout: float
    ) -> dict[str, Any]:
        try:
            return await asyncio.wait_for(
                self.primary.complete_json(
                    system, user, model=model, timeout=timeout
                ),
                timeout,
            )
        except asyncio.TimeoutError:
            self._note("timeout", model)
        except Exception as exc:  # noqa: BLE001 - any primary failure falls back
            self._note(f"error: {type(exc).__name__}", model)
        return await self.fallback.complete_json(
            system, user, model=model, timeout=timeout
        )
