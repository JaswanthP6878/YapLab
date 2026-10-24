# Requirements Document

## Introduction

This document specifies the bridge that connects the web app's Teaching room to the live FrontRow backend. When a backend URL is configured, a Teaching session is run by the backend's AI listeners instead of the in-browser demo: the presenter's voice is transcribed in the browser with ElevenLabs Scribe and sent as final transcript segments, the backend's events drive the avatars and room gauge, raised questions are spoken with the backend's synthesized audio when the presenter calls on them, and the session ends with the backend's report. The bridge follows the contract in `docs/backend-interface.md` and lives in `frontend/src/live/`.

## Glossary

- **Bridge**: The modules in `frontend/src/live/` and the `useLiveSession` hook.
- **Live_Mode**: A Teaching session with `VITE_API_URL` configured.
- **Backend**: The FrontRow server at `VITE_API_URL`.
- **Scribe**: ElevenLabs realtime speech-to-text (`scribe_v2_realtime`), opened in the browser with a backend-minted token.
- **Listener_Map**: The fixed mapping of backend listeners to avatars: L0 Alex (confused first-year), L1 Maya (skeptical professor), L2 Ana (ESL student), L3 Sam (distracted student), L4 Priya (domain expert).
- **Live_Report_Envelope**: `{kind: 'live', report, config}`, the stored result of a Live_Mode session.
- **Test_Bench**: The developer page `/live-test.html`.

## Requirements

### Requirement 1: When the Bridge Is Used

**User Story:** As a presenter, I want Teaching to use the real AI room when a backend is available, so that I get genuine reactions.

#### Acceptance Criteria

1. WHILE `VITE_API_URL` is configured and the Mode is Teaching, THE App SHALL run the session through the Bridge.
2. WHILE `VITE_API_URL` is not configured, or the Mode is Pitch or Interview, THE App SHALL use the demo engine.
3. THE App SHALL label only Live_Mode sessions and their reports as "Backend live"; other sessions and the sample report SHALL be labelled "Simulated agents".
4. THE Bridge SHALL use the backend's default five-listener room and map it to avatars with the Listener_Map.

### Requirement 2: Starting a Session

**User Story:** As a presenter, I want my slides understood by the room, so that questions relate to my material.

#### Acceptance Criteria

1. WHEN a Live_Mode session starts with an uploaded PDF, THE Bridge SHALL upload it to the Backend for slide text extraction.
2. WHEN a Live_Mode session starts with no upload, THE Bridge SHALL send only the built-in deck's slide titles and bullet points, never the demo's scripted presenter lines.
3. IF the uploaded deck is a set of images, THEN THE Bridge SHALL show that image decks are not supported for live sessions.
4. WHEN the session is created, THE Bridge SHALL connect the session WebSocket and synchronize only the current slide, leaving the session idle.
5. WHEN the presenter first clicks Speak or submits a typed line, THE Bridge SHALL send `start` once, sharing one pending start between concurrent callers, and SHALL send the first transcript only after `start` is acknowledged.
6. WHILE the session is idle, THE App SHALL show "Click Speak when you're ready. The room is listening." and keep the session clock stopped.
7. IF `start` fails or is rejected, THEN THE Bridge SHALL send no transcript and SHALL let the presenter try Speak again.
8. WHEN the presenter leaves an idle room, THE Bridge SHALL close its socket; WHEN the presenter leaves during a pending start, THE Bridge SHALL wait for that start and then end the talk, Q&A, and session.

### Requirement 3: Transport

**User Story:** As a presenter, I want a brief network drop not to ruin my session, so that practice continues.

#### Acceptance Criteria

1. THE Bridge SHALL correlate each Command with its ack or error by id, and time out requests that receive no reply.
2. IF the connection drops, THEN THE Bridge SHALL reject pending requests rather than resend them, reconnect with `replay=1`, and rebuild hands, meters, and the transcript sequence from the replayed events without replaying old voices or sounds.
3. IF the Backend closes the socket with code `4404`, THEN THE Bridge SHALL report that the session is no longer available and stop reconnecting.
4. WHEN the Bridge reconnects, THE Bridge SHALL resynchronize the slide without starting the talk.

### Requirement 4: Speech Input

**User Story:** As a presenter, I want to just talk, so that practicing feels natural.

#### Acceptance Criteria

1. WHEN the microphone starts, THE Bridge SHALL request a Scribe token from the Backend and open Scribe with the token's language (English by default, with no secondary languages), voice-activity commits, and echo cancellation, noise suppression, and gain control on the microphone.
2. WHEN Scribe commits a final segment, THE Bridge SHALL send it as a `transcript` with the next increasing `seq` and its spoken duration in seconds.
3. THE Bridge SHALL show a caption as final only after the Backend acknowledges it with `accepted: true`.
4. WHILE question audio is playing, THE Bridge SHALL mute transcription.
5. THE Test_Bench SHALL accept typed transcripts that share the same `seq` counter.

### Requirement 5: Room State

**User Story:** As a presenter, I want the avatars to show how the real listeners feel, so that I can read the room.

#### Acceptance Criteria

1. WHEN the Backend sends reactions, hands, verdicts, or room gauges, THE Bridge SHALL update the matching avatars' states, meters, and bubbles and the room gauge.
2. WHEN the presenter's own transcript arrives, THE App SHALL add it to the transcript, word count, and filler count without resetting avatar states, raised hands, or question and verdict bubbles.
3. WHILE a listener's hand is raised, THE Bridge SHALL keep it visible when that listener's periodic reaction arrives or when a different question from the same listener is pooled, lowered, or taken.

### Requirement 6: Questions and Answers

**User Story:** As a presenter, I want to call on students and hear their questions, so that I can practice answering.

#### Acceptance Criteria

1. WHEN the presenter calls on a raised hand, THE Bridge SHALL send `take_question`, play the question's audio, and bracket playback with `playback_started` and `playback_ended`.
2. THE Bridge SHALL play questions one at a time in arrival order and cache backend audio until the presenter calls on the question.
3. IF synthesis failed or no audio arrives within 5 seconds, THEN THE Bridge SHALL speak the question with the browser's speech synthesis.
4. IF the browser blocks autoplay, THEN THE Bridge SHALL offer an "Enable audio" action.
5. WHEN voices are turned off, THE Bridge SHALL cancel question audio and keep the question text visible.
6. WHEN the presenter chooses Done answering, End talk, Next question, or Finish, THE Bridge SHALL send `answer_done`, `end_presenting`, `next_question`, or `end_qa` then `finish`, respectively.
7. THE Bridge SHALL show how many questions are ready for Q&A, capped at the Q&A limit of five.
8. WHEN a live (not replayed) `answer_verdict` arrives, THE Bridge SHALL show the listener's name, verdict, and comment for six seconds.

### Requirement 7: Slides

**User Story:** As a presenter, I want slides to turn instantly, so that the network never slows my talk.

#### Acceptance Criteria

1. WHEN the presenter changes slides, THE App SHALL show the new slide immediately and send the change to the Backend in the background.
2. IF sending the slide fails, THEN THE Bridge SHALL keep the latest intended slide and resend it after reconnecting.
3. WHEN the presenter changes slides, THE Bridge SHALL clear only slide-sync errors and leave other errors visible.

### Requirement 8: Report

**User Story:** As a presenter, I want my real results kept after the session, so that I can revisit them.

#### Acceptance Criteria

1. WHEN a Live_Mode session finishes, THE App SHALL fetch the Backend report and show it.
2. THE App SHALL store the result as a Live_Report_Envelope so that "Last report" reopens the same backend report; demo reports SHALL keep their existing format.
3. WHEN the presenter goes back to Setup from a live report, THE App SHALL restore the audience chosen in Setup, not the fixed live roster.

### Requirement 9: Ambience

**User Story:** As a presenter, I want a subtle classroom atmosphere without random noises, so that the room feels alive but never distracts me mid-sentence.

#### Acceptance Criteria

1. WHERE ambient noise and voices are on, THE Bridge SHALL loop a quiet room tone and lower it while question audio plays.
2. THE Bridge SHALL build sound URLs from the app's base URL so that sounds work when deployed under a path prefix.
3. THE Bridge SHALL NOT play sound effects (pen clicks, yawns, rustles, phone buzzes, whispers, chair creaks) in response to reactions, room gauges, or raised hands.

### Requirement 10: Diagnostics and Testing

**User Story:** As a developer, I want visibility and tests without slowing the product UI, so that the bridge is debuggable and safe to change.

#### Acceptance Criteria

1. THE Bridge SHALL keep bounded event (300) and transcript-ack (100) logs outside React state, rendering them only when the Test_Bench opts in.
2. THE repository SHALL provide the Test_Bench at `/live-test.html` for manual end-to-end checks.
3. THE repository SHALL provide offline tests runnable with `npm run test:live`.
