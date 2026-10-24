"""LLM client interface.

All model access in FrontRow goes through :class:`LLMClient` so that the
deterministic :class:`~frontrow.llm.fake.FakeLLM` can be swapped in for tests
and replay, and act as a fallback when a real client fails.
"""

from __future__ import annotations

import abc
import json
import re
from typing import Any

# Matches the first balanced-ish JSON object. We intentionally keep this simple
# and tolerant: find the first "{" and the last "}" and try to parse.
_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


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
