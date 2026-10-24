"""Time-windowed transcript buffer.

Stores recognized speech chunks in arrival order and returns the most recent
window on request so listeners react to the latest part of the talk.
"""

from __future__ import annotations

from .models import TranscriptChunk


class TranscriptBuffer:
    """A buffer of :class:`TranscriptChunk` supporting time-window queries."""

    def __init__(self) -> None:
        self._chunks: list[TranscriptChunk] = []

    def append(self, chunk: TranscriptChunk) -> None:
        """Append a chunk to the buffer, preserving arrival order."""
        self._chunks.append(chunk)

    @property
    def chunks(self) -> list[TranscriptChunk]:
        """All chunks received so far, in order."""
        return list(self._chunks)

    def window(self, now: float, window_seconds: float) -> list[TranscriptChunk]:
        """Return chunks whose end falls within ``[now - window, now]``.

        If the window reaches before the start of the session (i.e. the window
        exceeds elapsed time), every chunk spoken so far is returned. Chunks
        ending after ``now`` are never included.
        """
        lower = now - window_seconds
        return [c for c in self._chunks if lower <= c.end <= now]

    def full_text(self, chunks: list[TranscriptChunk] | None = None) -> str:
        """Join the text of ``chunks`` (or all chunks) into one string."""
        source = self._chunks if chunks is None else chunks
        return " ".join(c.text for c in source).strip()
