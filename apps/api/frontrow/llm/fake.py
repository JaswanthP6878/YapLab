"""Deterministic offline LLM for tests, replay, and fallback.

:class:`FakeLLM` returns byte-for-byte identical output for identical
``(system, user, model)`` input. When the prompt is a reaction request (it
carries a known marker and a parseable persona name + source text), it emits a
plausible JSON reaction whose attention/confusion/understanding/question are
derived deterministically from a hash of the input. Any question it emits
quotes a real contiguous span of the provided transcript/slide text so it
passes grounding.
"""

from __future__ import annotations

import hashlib
import json
import re

from .base import LLMClient

# Markers the agent embeds in prompts so the fake can recognize a reaction
# request and extract the quotable source text and persona.
REACTION_MARKER = "[[FRONTROW_REACTION]]"
PERSONA_MARKER = "PERSONA_NAME:"
SOURCE_BEGIN = "[[SOURCE_TEXT_BEGIN]]"
SOURCE_END = "[[SOURCE_TEXT_END]]"
PROPENSITY_MARKER = "QUESTION_PROPENSITY:"
ANSWER_MARKER = "[[FRONTROW_ANSWER]]"
ANSWER_BEGIN = "[[ANSWER_TEXT_BEGIN]]"
ANSWER_END = "[[ANSWER_TEXT_END]]"
SUMMARY_MARKER = "[[FRONTROW_SUMMARY]]"
PREVIOUS_SUMMARY_BEGIN = "[[PREVIOUS_SUMMARY_BEGIN]]"
PREVIOUS_SUMMARY_END = "[[PREVIOUS_SUMMARY_END]]"
NEW_SPEECH_BEGIN = "[[NEW_SPEECH_BEGIN]]"
NEW_SPEECH_END = "[[NEW_SPEECH_END]]"
NO_SUMMARY_YET = "(none yet)"

_SOURCE_RE = re.compile(
    re.escape(SOURCE_BEGIN) + r"(.*?)" + re.escape(SOURCE_END), re.DOTALL
)
_PERSONA_RE = re.compile(re.escape(PERSONA_MARKER) + r"\s*(.+)")
_PROPENSITY_RE = re.compile(re.escape(PROPENSITY_MARKER) + r"\s*([0-9.]+)")
_SLIDE_LABEL_RE = re.compile(r"^\[slide [^\]]*\]\s*")
_WORD_SPAN_RE = re.compile(r"\S+")
_ANSWER_RE = re.compile(
    re.escape(ANSWER_BEGIN) + r"(.*?)" + re.escape(ANSWER_END), re.DOTALL
)
_PREVIOUS_SUMMARY_RE = re.compile(
    re.escape(PREVIOUS_SUMMARY_BEGIN) + r"(.*?)" + re.escape(PREVIOUS_SUMMARY_END),
    re.DOTALL,
)
_NEW_SPEECH_RE = re.compile(
    re.escape(NEW_SPEECH_BEGIN) + r"(.*?)" + re.escape(NEW_SPEECH_END), re.DOTALL
)
_ASKED_RE = re.compile(r"You asked: (.*)\nIt was about: \"(.*)\"")
_CONTENT_WORD_RE = re.compile(r"[a-z0-9']{4,}")
_STOPWORDS = frozenset(
    "that this with from have what when where which about there their they "
    "them then than into just your you're could would should does were been "
    "being more some very also only like said mean meant explain again".split()
)

# Spoken question templates keyed by a word in the persona name. ``{topic}``
# is a few words taken from the grounded quote.
_QUESTION_TEMPLATES: dict[str, str] = {
    "confused": "Sorry, I got lost there. What does {topic} actually mean?",
    "skeptical": "What evidence backs up the point about {topic}?",
    "ESL": "Could you explain the part about {topic} more slowly, please?",
    "distracted": "Sorry, can you repeat the bit about {topic}?",
    "expert": "How does {topic} hold up in a real production system?",
}
_DEFAULT_TEMPLATE = "Could you say a bit more about {topic}?"
_FOLLOW_UP_TEMPLATE = "You mentioned {topic}. Could you go one step further on that?"


def _topic(quote: str, max_words: int = 4) -> str:
    """A short spoken topic phrase: the last few words of ``quote``."""
    words = [w.strip(".,;:!?\"'()") for w in quote.split()]
    words = [w for w in words if w]
    return " ".join(words[-max_words:])


def _spoken_question(persona: str, quote: str) -> str:
    template = next(
        (t for key, t in _QUESTION_TEMPLATES.items() if key in persona),
        _DEFAULT_TEMPLATE,
    )
    return template.format(topic=_topic(quote))


def _content_words(text: str) -> set[str]:
    return {w for w in _CONTENT_WORD_RE.findall(text.lower()) if w not in _STOPWORDS}


def _digest(*parts: str) -> int:
    """Return a stable integer digest of the given parts."""
    h = hashlib.sha256("\x00".join(parts).encode("utf-8")).hexdigest()
    return int(h, 16)


class FakeLLM(LLMClient):
    """A deterministic LLM that never touches the network."""

    async def complete(
        self, system: str, user: str, *, model: str, timeout: float
    ) -> str:
        combined = f"{system}\n{user}"
        if REACTION_MARKER in combined:
            return self._reaction_response(system, user, model)
        if ANSWER_MARKER in combined:
            return self._answer_response(system, user, model)
        if SUMMARY_MARKER in combined:
            return self._summary_response(user)
        # Generic deterministic echo for non-reaction prompts.
        d = _digest(system, user, model)
        return json.dumps({"echo": d % 1_000_000})

    def _reaction_response(self, system: str, user: str, model: str) -> str:
        combined = f"{system}\n{user}"

        persona_match = _PERSONA_RE.search(combined)
        persona = persona_match.group(1).strip() if persona_match else "unknown"

        source_match = _SOURCE_RE.search(combined)
        source_text = source_match.group(1).strip() if source_match else ""

        propensity_match = _PROPENSITY_RE.search(combined)
        propensity = (
            float(propensity_match.group(1)) if propensity_match else 0.5
        )

        # Deterministic base values derived from persona + source content +
        # model. Different personas therefore yield different, stable results.
        seed = _digest(persona, source_text, model)
        attention = float(seed % 101)  # 0..100
        confusion = float((seed // 101) % 101)  # 0..100

        # Deterministic understanding snippet.
        understood = (
            f"{persona} followed the gist"
            if confusion < 50
            else f"{persona} got a bit lost"
        )

        # Decide whether this persona asks a question this tick. We combine the
        # persona's propensity with a stable per-input roll so that some
        # personas ask and some don't, deterministically.
        roll = (seed % 1000) / 1000.0
        asks = roll < propensity and bool(source_text)

        payload: dict[str, object] = {
            "attention": attention,
            "confusion": confusion,
            "understood": understood,
        }

        if asks:
            quote = self._pick_quote(source_text, seed)
            if quote:
                payload["question"] = _spoken_question(persona, quote)
                payload["quote"] = quote

        return json.dumps(payload)

    @staticmethod
    def _summary_response(user: str) -> str:
        """Append the first words of each new sentence to the previous summary."""
        prev_match = _PREVIOUS_SUMMARY_RE.search(user)
        new_match = _NEW_SPEECH_RE.search(user)
        previous = prev_match.group(1).strip() if prev_match else ""
        if previous == NO_SUMMARY_YET:
            previous = ""
        new = new_match.group(1).strip() if new_match else ""
        gist = " ".join(
            " ".join(sentence.split()[:8])
            for sentence in re.split(r"(?<=[.!?])\s+", new)
            if sentence.strip()
        )
        summary = f"{previous} {gist}".strip()
        return json.dumps({"summary": summary[-800:]})

    def _answer_response(self, system: str, user: str, model: str) -> str:
        """Judge an answer by how much of the question's content it covers.

        Deterministic and content-aware: an answer that reuses two or more
        content words from the question/quote counts as answered, one as
        partial, none (or a very short answer) as dodged.
        """
        combined = f"{system}\n{user}"
        persona_match = _PERSONA_RE.search(combined)
        persona = persona_match.group(1).strip() if persona_match else "unknown"
        propensity_match = _PROPENSITY_RE.search(combined)
        propensity = float(propensity_match.group(1)) if propensity_match else 0.5
        answer_match = _ANSWER_RE.search(combined)
        answer = answer_match.group(1).strip() if answer_match else ""
        asked_match = _ASKED_RE.search(combined)
        asked = " ".join(asked_match.groups()) if asked_match else ""

        overlap = _content_words(asked) & _content_words(answer)
        if len(answer.split()) < 5 or not overlap:
            verdict = "dodged"
        elif len(overlap) >= 2:
            verdict = "answered"
        else:
            verdict = "partial"

        payload: dict[str, object] = {
            "verdict": verdict,
            "comment": (
                f"{persona}: the answer covered {len(overlap)} of the key "
                "points I asked about."
            ),
        }
        seed = _digest(persona, asked, answer, model)
        if verdict == "partial" and (seed % 1000) / 1000.0 < propensity:
            quote = self._pick_quote(answer, seed)
            if quote:
                payload["follow_up"] = _FOLLOW_UP_TEMPLATE.format(topic=_topic(quote))
                payload["quote"] = quote
        return json.dumps(payload)

    @staticmethod
    def _pick_quote(source_text: str, seed: int, min_chars: int = 12) -> str:
        """Deterministically pick a real contiguous span from ``source_text``.

        Picks one line of the source (the transcript, or a single slide with
        its ``[slide n]`` label removed) and returns a run of whole words from
        it of at least ``min_chars``, so it reads naturally and passes
        grounding. Returns ``""`` if no line is long enough.
        """
        lines = [
            _SLIDE_LABEL_RE.sub("", line).strip()
            for line in source_text.splitlines()
        ]
        lines = [line for line in lines if len(line) >= min_chars]
        if not lines:
            return ""
        text = lines[seed % len(lines)]
        words = list(_WORD_SPAN_RE.finditer(text))
        first = (seed // 7) % len(words)
        # Aim for 3-7 words, then extend until the span is long enough.
        last = min(first + 2 + (seed // 11) % 5, len(words) - 1)
        while last < len(words) - 1 and (
            words[last].end() - words[first].start() < min_chars
        ):
            last += 1
        while first > 0 and words[last].end() - words[first].start() < min_chars:
            first -= 1
        return text[words[first].start() : words[last].end()]
