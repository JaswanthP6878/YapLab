"""Grounding: every question must quote real talk or slide content.

A question is grounded only if it carries a quoted span of at least
``min_chars`` that is a contiguous substring of either the transcript window
text or the text of some slide.

Matching tolerates the drift real models introduce when quoting (letter case,
runs of whitespace, curly vs straight quotes, wrapping quote marks or an
ellipsis), but the span retained on the :class:`GroundedQuestion` is always
the exact text as it appears in the source.
"""

from __future__ import annotations

from typing import Any

from .models import GroundedQuestion, Slide

# Typographic characters folded to their ASCII equivalents before matching.
_CHAR_FOLD = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "“": '"',
        "”": '"',
        "–": "-",
        "—": "-",
    }
)
# Characters stripped from both ends of a model-supplied quote.
_QUOTE_TRIM = " \t\r\n\"'‘’“”…."


def _normalize_with_map(text: str) -> tuple[str, list[int]]:
    """Normalize ``text`` and map each normalized char to its source index.

    Normalization lowercases, folds typographic characters, and collapses any
    whitespace run to a single space.
    """
    out: list[str] = []
    index_map: list[int] = []
    prev_space = False
    for i, ch in enumerate(text):
        if ch.isspace():
            if prev_space:
                continue
            out.append(" ")
            prev_space = True
        else:
            out.append(ch.translate(_CHAR_FOLD).lower())
            prev_space = False
        index_map.append(i)
    return "".join(out), index_map


def _find_span(quote: str, source: str) -> str | None:
    """Return the exact substring of ``source`` matching ``quote``, or None."""
    if quote in source:
        return quote
    norm_quote, _ = _normalize_with_map(quote)
    norm_source, index_map = _normalize_with_map(source)
    pos = norm_source.find(norm_quote)
    if pos < 0:
        return None
    start = index_map[pos]
    end = index_map[pos + len(norm_quote) - 1] + 1
    return source[start:end]


def check_grounding(
    question_text: str,
    quote: str,
    transcript_text: str,
    slides: list[Slide] | None,
    min_chars: int,
) -> GroundedQuestion | None:
    """Verify ``quote`` against the transcript and slides.

    Returns a :class:`GroundedQuestion` with the correct ``source`` label when
    the quote is a contiguous substring of length ``>= min_chars`` of the
    transcript or a slide, otherwise ``None``.
    """
    if quote is None:
        return None
    quote = quote.strip(_QUOTE_TRIM)
    if len(quote) < min_chars:
        return None

    if transcript_text:
        span = _find_span(quote, transcript_text)
        if span is not None:
            return GroundedQuestion(
                question=question_text, quote=span, source="transcript"
            )

    for slide in slides or []:
        if not slide.text:
            continue
        span = _find_span(quote, slide.text)
        if span is not None:
            return GroundedQuestion(
                question=question_text,
                quote=span,
                source=f"slide:{slide.index}",
            )

    return None


def validate_question_payload(
    payload: dict[str, Any],
    transcript_text: str,
    slides: list[Slide] | None,
    min_chars: int,
) -> GroundedQuestion | None:
    """Validate a raw model payload containing ``question`` and ``quote``.

    Convenience wrapper over :func:`check_grounding` for model output.
    """
    question_text = payload.get("question")
    quote = payload.get("quote")
    if not question_text or not quote:
        return None
    return check_grounding(
        str(question_text), str(quote), transcript_text, slides, min_chars
    )
