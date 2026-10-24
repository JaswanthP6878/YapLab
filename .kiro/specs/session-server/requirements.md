# Requirements Document

## Introduction

This document specifies the FrontRow server: the REST and WebSocket interface that the browser uses to run a practice session, the typed wire protocol behind it, and the seams where speech engines plug in. REST covers setup and retrieval (create a session from slide text or a PDF, mint a speech-to-text token, fetch question audio, read the timeline and report). One WebSocket per session carries everything live: commands from the browser, an acknowledgement or error for each, and every timeline event as it happens.

## Glossary

- **Server**: The FastAPI application in `frontrow/server.py`.
- **Client**: A browser (or tool) connected to the Server.
- **Session_Info**: `{id, state, preset, current_slide, listeners: [{id, persona}], slides: [{index, text}]}`.
- **Command**: A Client message on the WebSocket, tagged by `type` and optionally carrying an `id`.
- **Ack**: A Server reply `{type: "ack", id, request, result}` to a successful Command.
- **Error_Reply**: A Server reply `{type: "error", id, request, message, detail}`.
- **Event_Message**: A Server message `{type: "event", event, t, data}` wrapping one timeline event.
- **TTS_Engine**: The pluggable component that turns a question's text into audio.
- **STT_Token_Provider**: The pluggable component that mints short-lived speech-to-text credentials for the browser.
- **Protocol_Schema**: The JSON schema generated from `frontrow/protocol.py`, stored in `packages/protocol/schema.json`.

## Requirements

### Requirement 1: Creating Sessions

**User Story:** As a frontend developer, I want to create a session from slide text or a PDF, so that the room knows what the talk is about.

#### Acceptance Criteria

1. WHEN a Client posts `{preset?, slides?, tick_interval_seconds?}` to `/sessions`, THE Server SHALL create a Session and return `201` with its Session_Info.
2. WHEN a Client uploads a PDF to `/sessions/upload`, THE Server SHALL extract one slide per page and create the Session.
3. IF the preset is unknown or the tick interval is outside 1-300 seconds, THEN THE Server SHALL return `400` with the reason.
4. IF the upload is empty, not a PDF, or unreadable, THEN THE Server SHALL return `400`; IF it exceeds 100 MB, THEN THE Server SHALL return `413`.
5. WHEN a Client requests `/sessions/{id}` or `/sessions/{id}/events?since=N`, THE Server SHALL return the Session_Info or the timeline from index N, and `404` for an unknown session.

### Requirement 2: Session WebSocket

**User Story:** As a frontend developer, I want one socket that carries every live interaction, so that the UI stays in sync with the room.

#### Acceptance Criteria

1. WHEN a Client connects to `/sessions/{id}/ws`, THE Server SHALL first send `hello` with the Session_Info, including the whole timeline when the Client passes `replay=1`.
2. IF the session does not exist, THEN THE Server SHALL send one Error_Reply and close the socket with code `4404`, sending no events.
3. WHEN a Command is valid for the session's state, THE Server SHALL apply it and reply with an Ack echoing the Command's `id`.
4. IF a Command is invalid for the current state, THEN THE Server SHALL reply with an Error_Reply and leave the state unchanged.
5. IF a message does not match the protocol, THEN THE Server SHALL reply with an Error_Reply listing the validation errors and keep the connection open.
6. THE Server SHALL apply Commands for one session one at a time, even when several Clients are connected.

### Requirement 3: Streaming Events

**User Story:** As a frontend developer, I want every room event pushed to me, so that I do not need to poll.

#### Acceptance Criteria

1. WHEN a timeline event is recorded, THE Server SHALL send it as an Event_Message to every Client connected to that session.
2. THE Server SHALL deliver the `hello` backlog and the live stream with no gap and no duplicates.
3. IF a Client falls more than 1000 messages behind, THEN THE Server SHALL close its socket with code `1013` rather than slow the session.
4. WHEN a Client disconnects, THE Server SHALL stop sending to it and release its resources.

### Requirement 4: Speech Engine Seams

**User Story:** As a speech developer, I want small interfaces to implement, so that I can add a provider without touching the rest of the backend.

#### Acceptance Criteria

1. THE Server SHALL depend only on a TTS_Engine with `synthesize(text, persona, listener_id) -> SpeechAudio` and an STT_Token_Provider with `create_token(session_id) -> STTToken`.
2. WHERE no engines are configured, THE Server SHALL deliver questions as text only and answer token requests with `501`.
3. THE Server SHALL accept engines injected into `create_app`, taking precedence over the environment configuration.

### Requirement 5: Speech-to-Text Tokens

**User Story:** As a frontend developer, I want short-lived speech credentials, so that the browser never holds a provider API key.

#### Acceptance Criteria

1. WHEN a Client posts to `/sessions/{id}/stt-token` for a session that is idle, presenting, or in Q&A, THE Server SHALL return the token, provider, expiry, and any provider extras.
2. IF the session is over, THEN THE Server SHALL return `409`; IF the provider fails, THEN THE Server SHALL return `502`.

### Requirement 6: Question Audio

**User Story:** As a Presenter, I want to hear students ask their questions, so that the practice feels real.

#### Acceptance Criteria

1. WHEN a hand is raised or a Q&A question is asked and a TTS_Engine is configured, THE Server SHALL synthesize the spoken question once per question id and cache it.
2. WHEN audio is ready, THE Server SHALL record `question_audio` with the question id, a URL, and the content type.
3. IF synthesis fails, THEN THE Server SHALL record `question_audio_failed` so that the Client can fall back to text.
4. WHEN a Client requests `/sessions/{id}/audio/{question_id}`, THE Server SHALL return the cached audio, or `404` when there is none.

### Requirement 7: Report Endpoint

**User Story:** As a Presenter, I want my results when the session is done, so that I can review them.

#### Acceptance Criteria

1. IF the session has not reached Reporting, THEN THE Server SHALL return `409` from `/sessions/{id}/report`.
2. WHEN the session is in Reporting or Ended, THE Server SHALL return the room score per tick, question and verdict counts with each verdict, and delivery statistics (duration, words, words per minute, filler words, longest pause).

### Requirement 8: Wire Protocol

**User Story:** As a frontend developer, I want a machine-readable contract, so that client and server cannot drift apart silently.

#### Acceptance Criteria

1. THE Server SHALL define every Command and Server message as typed models in `frontrow/protocol.py`.
2. THE repository SHALL contain the Protocol_Schema generated from those models.
3. THE repository SHALL document every endpoint, Command, and event in `docs/backend-interface.md`.

### Requirement 9: Cross-Origin Access and Shutdown

**User Story:** As an operator, I want the server reachable from the dev frontend and to stop cleanly.

#### Acceptance Criteria

1. THE Server SHALL allow browser origins listed in `FRONTROW_CORS_ORIGINS`, defaulting to all origins.
2. WHEN the Server shuts down, THE Server SHALL stop every session's background work, settle pending audio tasks, and then close engine and model clients.

### Requirement 10: Testing Without a Frontend

**User Story:** As a developer, I want to exercise the whole server without a browser, so that backend work is not blocked on the UI.

#### Acceptance Criteria

1. THE repository SHALL provide a scripted client that creates a session, streams a scenario's transcript in real time, optionally calls on a raised hand, runs Q&A, and prints the report.
2. THE offline checks SHALL drive a full session over REST and WebSocket with stub speech engines.
