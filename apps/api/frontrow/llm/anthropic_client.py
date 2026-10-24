"""Claude Messages adapter with optional, lazily imported Anthropic SDK.

SDK: https://platform.claude.com/docs/en/api/sdks/python
JSON: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
"""

from __future__ import annotations

import json
import os

from .base import LLMClient, parse_json_object


class AnthropicClient(LLMClient):
    """One system prompt and one user message, returning a JSON object only."""

    def __init__(self, api_key: str | None = None) -> None:
        try:
            from anthropic import AsyncAnthropic  # lazy import
        except ImportError as exc:  # pragma: no cover - env dependent
            raise RuntimeError(
                "The 'anthropic' package is not installed. Install the optional "
                "dependency group: pip install -e '.[anthropic]'"
            ) from exc

        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not set. Provide an api_key or set the "
                "environment variable to use the Anthropic client."
            )
        # The existing FallbackLLM owns the total request deadline. Avoid SDK
        # retries spending several per-request timeouts before that fallback.
        self._client = AsyncAnthropic(api_key=key, max_retries=0)
        self._closed = False

    async def aclose(self) -> None:
        """Release the SDK's pooled HTTP client once requests have stopped."""
        if not self._closed:
            await self._client.close()
            self._closed = True

    async def complete(
        self, system: str, user: str, *, model: str, timeout: float
    ) -> str:
        # Structured outputs require a closed, explicit JSON schema. This
        # generic LLMClient seam has no schema argument and serves multiple
        # contracts, so enforce JSON at this boundary without coupling it to
        # reaction/answer prompts or changing the shared interface.
        json_system = (
            f"{system}\n\nReturn exactly one valid JSON object. "
            "Do not include Markdown fences, prose, or any text outside the object."
        )
        options = {}
        if model == "claude-haiku-5-5":
            # Haiku 5.5 thinks by default; at a 1024-token limit this can use
            # the whole budget before producing the short listener response.
            options["thinking"] = {"type": "disabled"}
        response = await self._client.messages.create(
            model=model,
            system=json_system,
            messages=[{"role": "user", "content": user}],
            max_tokens=1024,
            timeout=timeout,
            **options,
        )
        text = "".join(block.text for block in response.content if block.type == "text")
        parsed = parse_json_object(text)
        if not isinstance(parsed, dict):
            raise ValueError("The Anthropic response did not contain a JSON object.")
        return json.dumps(parsed, ensure_ascii=False, allow_nan=False)
