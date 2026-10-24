"""Optional ElevenLabs speech engines using the backend's existing interfaces.

Flash uses the TTS REST SDK iterator. Expressive conversational models use
the documented Text-to-Dialogue WebSocket, with one registered voice.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
from pathlib import Path
from time import monotonic
from typing import Any
from urllib.parse import urlencode

from .speech import SpeechAudio, STTToken

logger = logging.getLogger(__name__)
DEFAULT_MODEL = "eleven_flash_v2_5"
VOICES_PATH = Path(__file__).with_name("voices.json")
_DIALOGUE_MODELS = {"eleven_v4_turbo", "eleven_v3_conversational"}


class SpeechProviderError(RuntimeError):
    """A speech-service error safe for the server's public failure events."""


class _ElevenLabsEngine:
    def __init__(self, api_key: str | None = None, *, http_client: Any = None) -> None:
        try:
            import httpx
            from elevenlabs.client import AsyncElevenLabs
        except ImportError:
            raise RuntimeError(
                "ElevenLabs speech dependencies are not installed. "
                "Run uv sync --extra elevenlabs in apps/api."
            ) from None
        key = (api_key or os.environ.get("ELEVENLABS_API_KEY", "")).strip()
        if not key:
            raise RuntimeError("ELEVENLABS_API_KEY is not set for ElevenLabs speech.")
        self._api_key = key
        self._owns_http_client = http_client is None
        self._http_client = http_client if http_client is not None else httpx.AsyncClient(timeout=30)
        self._client = AsyncElevenLabs(api_key=key, httpx_client=self._http_client)
        self._closed = False

    def _check_open(self) -> None:
        if self._closed:
            raise SpeechProviderError("This speech engine is closed.")

    async def aclose(self) -> None:
        """Release our pooled HTTP client once the application lifespan ends."""
        if not self._closed:
            self._closed = True
            if self._owns_http_client:
                await self._http_client.aclose()


class ElevenLabsTTS(_ElevenLabsEngine):
    """Generate complete MP3 questions with stable persona/listener voices."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        model_id: str | None = None,
        voices_path: str | Path | None = None,
        http_client: Any = None,
    ) -> None:
        path = Path(voices_path) if voices_path is not None else VOICES_PATH
        try:
            voices = json.loads(path.read_text())
        except (OSError, ValueError):
            raise RuntimeError("Could not read the ElevenLabs persona voice map.") from None
        if not isinstance(voices, dict) or not voices or any(
            not isinstance(persona, str)
            or not isinstance(ids, list)
            or len(ids) < 2
            or any(not isinstance(voice_id, str) or not voice_id.strip() for voice_id in ids)
            or len(set(ids)) != len(ids)
            for persona, ids in voices.items()
        ):
            raise RuntimeError("Each speech persona needs at least two distinct voice IDs.")
        self.voices: dict[str, list[str]] = voices
        self.model_id = (model_id or os.environ.get("FRONTROW_TTS_MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
        super().__init__(api_key, http_client=http_client)

    def voice_for(self, persona: str, listener_id: str) -> str:
        """Choose L3's voice at index 3 modulo the persona's voice count."""
        if persona not in self.voices:
            raise ValueError(f"Unknown speech persona: {persona!r}")
        match = re.fullmatch(r"L(\d+)", listener_id)
        if match is None:
            raise ValueError("listener_id must have the form L<number>.")
        voices = self.voices[persona]
        return voices[int(match.group(1)) % len(voices)]

    async def _dialogue(self, text: str, voice_id: str) -> bytes:
        from websockets.asyncio.client import connect

        query = urlencode({"model_id": self.model_id, "output_format": "mp3_44100_128"})
        uri = f"wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?{query}"
        chunks: list[bytes] = []
        async with asyncio.timeout(30):
            async with connect(
                uri,
                additional_headers={"xi-api-key": self._api_key},
                open_timeout=10,
                close_timeout=5,
                max_size=8 * 1024 * 1024,
            ) as socket:
                await socket.send(json.dumps({"voices": [voice_id]}))
                await socket.send(json.dumps({"inputs": [
                    {"text": text, "voice_id": voice_id, "new_turn": False}
                ]}))
                # Flush short questions and receive all audio before is_final.
                await socket.send(json.dumps({"close_socket": True}))
                while True:
                    message = json.loads(await socket.recv())
                    if message.get("error"):
                        raise SpeechProviderError("Question speech is temporarily unavailable.")
                    if message.get("audio"):
                        chunks.append(base64.b64decode(message["audio"], validate=True))
                    if message.get("is_final"):
                        return b"".join(chunks)

    async def synthesize(self, text: str, *, persona: str, listener_id: str) -> SpeechAudio:
        self._check_open()
        voice_id = self.voice_for(persona, listener_id)
        started = monotonic()
        try:
            if self.model_id in _DIALOGUE_MODELS:
                data = await self._dialogue(text, voice_id)
            else:
                data = b"".join([
                    chunk async for chunk in self._client.text_to_speech.convert(
                        voice_id=voice_id,
                        text=text,
                        model_id=self.model_id,
                        output_format="mp3_44100_128",
                        request_options={"max_retries": 0},
                    )
                ])
            if not data:
                raise SpeechProviderError("The speech provider returned empty question audio.")
        except SpeechProviderError:
            raise
        except Exception as error:
            logger.warning("elevenlabs_tts_failed error_type=%s", type(error).__name__)
            # Never expose provider exception bodies or request details.
            raise SpeechProviderError("Question speech is temporarily unavailable.") from None
        logger.info(
            "elevenlabs_tts model=%s listener=%s generation_ms=%d bytes=%d",
            self.model_id, listener_id, round((monotonic() - started) * 1000), len(data),
        )
        return SpeechAudio(data=data, content_type="audio/mpeg")


class ElevenLabsSTTTokens(_ElevenLabsEngine):
    """Mint one-use Scribe credentials; API keys never reach the browser."""

    async def create_token(self, session_id: str) -> STTToken:
        self._check_open()
        try:
            response = await self._client.tokens.single_use.create(
                token_type="realtime_scribe", request_options={"max_retries": 0}
            )
            if not isinstance(response.token, str) or not response.token:
                raise SpeechProviderError("The speech provider returned an empty STT token.")
        except SpeechProviderError:
            raise
        except Exception as error:
            logger.warning("elevenlabs_stt_token_failed error_type=%s", type(error).__name__)
            raise SpeechProviderError("Live transcription is temporarily unavailable.") from None
        return STTToken(
            token=response.token,
            provider="elevenlabs",
            expires_in_seconds=900,
            extra={
                "model_id": "scribe_v2_realtime",
                "vad_silence_threshold_secs": 0.7,
                "include_timestamps": True,
            },
        )
