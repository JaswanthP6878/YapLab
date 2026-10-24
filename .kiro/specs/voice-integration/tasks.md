# Implementation Plan

- [x] 1. Engine selection
  - `FRONTROW_TTS` / `FRONTROW_STT` with `none` | `elevenlabs`; lazy imports; injected engines bypass the environment
  - Optional dependency group `elevenlabs` in `pyproject.toml`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 2. Shared engine base
  - SDK and key validation, one pooled HTTP client, `aclose()`, closed-engine guard
  - _Requirements: 1.3, 1.4, 6.1, 6.2_

- [x] 3. Persona voices
  - [x] 3.1 `voices.json` with at least two distinct voices per persona; validation on load
    - _Requirements: 2.1_
  - [x] 3.2 `voice_for(persona, listener_id)` by listener number modulo pool size
    - _Requirements: 2.2, 2.3_
  - [x] 3.3 Disjoint pools and a distinct voice for every listener in every room preset
    - _Requirements: 2.4_

- [x] 4. Text-to-speech
  - [x] 4.1 REST synthesis for the Flash model (`mp3_44100_128`, no retries)
    - _Requirements: 3.1, 3.2_
  - [x] 4.2 Text-to-Dialogue WebSocket for `eleven_v4_turbo` / `eleven_v3_conversational` with a 30 s limit
    - _Requirements: 3.3_
  - [x] 4.3 Empty-audio and provider errors; timing and size logs visible under uvicorn
    - _Requirements: 3.4, 3.5_

- [x] 5. Speech-to-text tokens
  - Single-use `realtime_scribe` token with expiry and connection extras, including `language_code: en`
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Safe failures
  - Generic `SpeechProviderError` messages; type-only logging; keys never leave the backend
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 7. Server shutdown
  - Settle late voice tasks before closing engines; close shared clients once
  - _Requirements: 6.2_

- [x] 8. Verification and tooling
  - [x] 8.1 `verify_voice_integration.py` with SDK stand-ins, joined into `verify.py`
    - _Requirements: 7.1_
  - [x] 8.2 `scripts/list_voices.py` and `docs/voice-verification.md`
    - _Requirements: 7.2_
