# Requirements Document

## Introduction

This document specifies the ElevenLabs implementation of the backend's two speech seams: a text-to-speech engine that turns each listener's spoken question into audio in a stable, persona-appropriate voice, and a speech-to-text token provider that mints single-use realtime Scribe credentials so the browser can transcribe the presenter directly without ever holding an API key. Both engines are optional, selected by configuration, and degrade to text-only questions when absent or failing.

## Glossary

- **System**: The FrontRow backend.
- **TTS_Engine**: `ElevenLabsTTS`, implementing `synthesize(text, persona, listener_id)`.
- **STT_Token_Provider**: `ElevenLabsSTTTokens`, implementing `create_token(session_id)`.
- **Voice_Map**: `frontrow/voices.json`, mapping each persona name to a list of ElevenLabs voice ids.
- **Flash_Model**: The default low-latency model `eleven_flash_v2_5`, called through the REST text-to-speech API.
- **Dialogue_Model**: `eleven_v4_turbo` or `eleven_v3_conversational`, called through the Text-to-Dialogue WebSocket.
- **Scribe_Token**: A single-use `realtime_scribe` token the browser uses for live transcription.

## Requirements

### Requirement 1: Engine Selection

**User Story:** As a developer, I want to turn speech on and off with settings, so that the backend runs with or without an ElevenLabs account.

#### Acceptance Criteria

1. THE System SHALL select the TTS_Engine from `FRONTROW_TTS` and the STT_Token_Provider from `FRONTROW_STT`, each `none` (default) or `elevenlabs`.
2. IF either setting has another value, THEN THE System SHALL fail at startup with an error listing the accepted values.
3. IF `elevenlabs` is selected and the speech SDK is not installed, THEN THE System SHALL fail with an error naming `uv sync --extra elevenlabs`.
4. IF `elevenlabs` is selected and `ELEVENLABS_API_KEY` is empty, THEN THE System SHALL fail with an error naming that variable.
5. WHERE engines are injected directly into the application, THE System SHALL ignore the environment's speech settings and require neither the SDK nor the key for them.

### Requirement 2: Persona Voices

**User Story:** As a Presenter, I want each student to sound different and consistent, so that I can tell who is asking.

#### Acceptance Criteria

1. THE TTS_Engine SHALL load the Voice_Map and reject it unless every persona has at least two distinct, non-empty voice ids.
2. THE TTS_Engine SHALL choose a listener's voice from its persona's list at index (listener number modulo list length), so that the same listener always uses the same voice.
3. IF the persona is not in the Voice_Map or the listener id is not of the form `L<number>`, THEN THE TTS_Engine SHALL raise an error.
4. THE Voice_Map SHALL give different personas disjoint voice lists, and every room preset SHALL assign a distinct voice to each listener.

### Requirement 3: Question Synthesis

**User Story:** As a Presenter, I want questions spoken quickly, so that the conversation flows.

#### Acceptance Criteria

1. THE TTS_Engine SHALL use the model from `FRONTROW_TTS_MODEL`, defaulting to the Flash_Model.
2. WHERE the model is the Flash_Model or another non-dialogue model, THE TTS_Engine SHALL return the complete MP3 (`mp3_44100_128`) from the REST API with SDK retries disabled.
3. WHERE the model is a Dialogue_Model, THE TTS_Engine SHALL stream the question through the Text-to-Dialogue WebSocket with the listener's voice and return the joined audio, failing after 30 seconds.
4. IF the provider returns empty audio or an error, THEN THE TTS_Engine SHALL raise a speech error.
5. WHEN a question is synthesized, THE System SHALL log the model, listener, generation time in milliseconds, and audio size.

### Requirement 4: Speech-to-Text Tokens

**User Story:** As a frontend developer, I want a short-lived Scribe credential, so that the browser can transcribe without a provider key.

#### Acceptance Criteria

1. WHEN a token is requested, THE STT_Token_Provider SHALL mint a single-use `realtime_scribe` token with SDK retries disabled.
2. THE STT_Token_Provider SHALL return the token with provider `elevenlabs`, an expiry of 900 seconds, and the extras `model_id: scribe_v2_realtime`, `vad_silence_threshold_secs: 0.7`, and `include_timestamps: true`.
3. IF the provider returns an empty token, THEN THE STT_Token_Provider SHALL raise a speech error.

### Requirement 5: Safe Failures

**User Story:** As an operator, I want provider failures reported without leaking details, so that keys and request bodies never reach clients or logs.

#### Acceptance Criteria

1. IF a provider call fails, THEN THE System SHALL raise a generic speech error ("Question speech is temporarily unavailable." or "Live transcription is temporarily unavailable.") without the provider's exception text.
2. WHEN a provider call fails, THE System SHALL log only the exception type.
3. THE System SHALL never return `ELEVENLABS_API_KEY` to the browser; only Scribe_Tokens leave the backend.

### Requirement 6: Connection Reuse and Shutdown

**User Story:** As an operator, I want speech requests to reuse connections and close cleanly, so that latency stays low and shutdown is tidy.

#### Acceptance Criteria

1. THE System SHALL reuse one pooled HTTP client per engine for all requests.
2. WHEN the server shuts down, THE System SHALL close each engine's HTTP client it created, and refuse further requests on a closed engine.

### Requirement 7: Verification Without Credentials

**User Story:** As a developer, I want speech behavior tested without an account, so that CI and teammates can run the checks.

#### Acceptance Criteria

1. THE repository SHALL provide offline checks that replace the provider SDKs with in-memory stand-ins and clear the environment so no real key is used.
2. THE repository SHALL provide a script that lists the account's voices with their labels for building the Voice_Map.
