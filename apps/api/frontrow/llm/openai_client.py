"""Real LLM client backed by the OpenAI API.

The ``openai`` SDK is imported lazily so that importing this module never
requires the package to be installed. Constructing :class:`OpenAIClient`
raises a clear error if the SDK is missing or no API key is configured.
"""

from __future__ import annotations

import os

from .base import LLMClient


class OpenAIClient(LLMClient):
    """An :class:`LLMClient` that calls the OpenAI chat completions API."""

    def __init__(self, api_key: str | None = None) -> None:
        try:
            from openai import AsyncOpenAI  # lazy import
        except ImportError as exc:  # pragma: no cover - env dependent
            raise RuntimeError(
                "The 'openai' package is not installed. Install the optional "
                "dependency group: pip install -e '.[openai]'"
            ) from exc

        key = api_key or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set. Provide an api_key or set the "
                "environment variable to use the OpenAI client."
            )
        self._client = AsyncOpenAI(api_key=key)
        self._closed = False

    async def aclose(self) -> None:
        """Release the SDK's pooled HTTP client once requests have stopped."""
        if not self._closed:
            await self._client.close()
            self._closed = True

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
            timeout=timeout,
        )
        content = response.choices[0].message.content
        return content or ""
