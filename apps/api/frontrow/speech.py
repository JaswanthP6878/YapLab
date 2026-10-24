"""Speech engine interfaces: the seams for STT tokens and TTS.

The backend never does speech recognition itself: the browser streams mic
audio straight to the STT provider (ElevenLabs) using a short-lived token the
backend mints, and forwards final transcript segments back over the session
WebSocket. For questions, the backend turns each question's text into audio
with a :class:`TTSEngine` and serves it at ``/sessions/{id}/audio/{qid}``.

Implement these protocols (e.g. ``ElevenLabsTTS``, ``ElevenLabsSTTTokens``)
and pass them to :func:`frontrow.server.create_app`. The stand-ins below let
the server run, and tests pass, with neither configured.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class SpeechAudio:
    """Synthesized audio for one question."""

    data: bytes
    content_type: str = "audio/mpeg"


@dataclass(frozen=True)
class STTToken:
    """A short-lived credential the browser uses to talk to the STT provider.

    ``extra`` carries provider-specific fields the frontend needs (model id,
    websocket URL, sample rate, ...), passed through to the client verbatim.
    """

    token: str
    provider: str
    expires_in_seconds: float | None = None
    extra: dict[str, object] = field(default_factory=dict)


@runtime_checkable
class TTSEngine(Protocol):
    """Turns a listener's spoken question into audio."""

    async def synthesize(
        self, text: str, *, persona: str, listener_id: str
    ) -> SpeechAudio:
        """Return audio for ``text`` in the voice for ``persona``.

        ``listener_id`` lets a room with two listeners of the same persona
        use different voices. Raise on failure; the server records a
        ``question_audio_failed`` event and the frontend falls back to text.
        """
        ...


@runtime_checkable
class STTTokenProvider(Protocol):
    """Mints short-lived STT credentials so API keys never reach the browser."""

    async def create_token(self, session_id: str) -> STTToken:
        """Return a fresh token for ``session_id``. Raise on failure."""
        ...


class SpeechNotConfigured(RuntimeError):
    """Raised by the stand-ins when no real engine is plugged in."""


class NoTTS:
    """Stand-in: no audio. Questions are delivered as text only."""

    async def synthesize(
        self, text: str, *, persona: str, listener_id: str
    ) -> SpeechAudio:
        raise SpeechNotConfigured("no TTS engine configured")


class NoSTTTokens:
    """Stand-in: STT token minting is not configured."""

    async def create_token(self, session_id: str) -> STTToken:
        raise SpeechNotConfigured("no STT token provider configured")
