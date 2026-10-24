"""Room-level and delivery metrics.

Pure functions that turn per-listener reactions and transcript chunks into
the numbers used to gauge how a talk is landing: room attention, confusion,
and comprehension per tick, plus speaking rate and filler-word counts.
"""

from __future__ import annotations

import re

from .models import Reaction, TranscriptChunk

# Single- and multi-word fillers counted in delivery stats.
FILLER_WORDS = ("um", "uh", "erm", "like", "basically", "you know", "kind of", "sort of")

_WORD_RE = re.compile(r"[A-Za-z0-9']+")


def comprehension(attention: float, confusion: float) -> float:
    """Comprehension in 0..100: how much was heard *and* understood."""
    return attention * (100.0 - confusion) / 100.0


def room_summary(reactions: list[Reaction]) -> dict[str, float | None]:
    """Mean attention, confusion, and comprehension across ``reactions``.

    Values are ``None`` when no listener reacted.
    """
    if not reactions:
        return {"attention": None, "confusion": None, "comprehension": None}
    n = len(reactions)
    attention = sum(r.attention for r in reactions) / n
    confusion = sum(r.confusion for r in reactions) / n
    comp = sum(comprehension(r.attention, r.confusion) for r in reactions) / n
    return {
        "attention": round(attention, 1),
        "confusion": round(confusion, 1),
        "comprehension": round(comp, 1),
    }


def word_count(text: str) -> int:
    """Number of words in ``text``."""
    return len(_WORD_RE.findall(text))


def filler_count(text: str) -> int:
    """Number of filler words/phrases in ``text`` (whole-word matches)."""
    lowered = text.lower()
    return sum(
        len(re.findall(rf"\b{re.escape(f)}\b", lowered)) for f in FILLER_WORDS
    )


def speaking_rate(
    chunks: list[TranscriptChunk], start: float, end: float
) -> float | None:
    """Words per minute for chunks ending in ``(start, end]``.

    Returns ``None`` for an empty interval.
    """
    if end <= start:
        return None
    words = sum(word_count(c.text) for c in chunks if start < c.end <= end)
    return round(words * 60.0 / (end - start), 1)


def longest_pause(chunks: list[TranscriptChunk]) -> float:
    """Longest silent gap in seconds between consecutive chunks."""
    gaps = [b.start - a.end for a, b in zip(chunks, chunks[1:])]
    return round(max([0.0, *gaps]), 2)
