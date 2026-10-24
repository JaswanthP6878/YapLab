# Implementation Plan

- [x] 1. Wire protocol
  - Typed Commands and Server messages in `protocol.py`; schema export to `packages/protocol/schema.json`
  - _Requirements: 8.1, 8.2_

- [x] 2. Speech engine seams
  - `speech.py` protocols, data classes, and stand-ins; injection through `create_app`
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. Slide extraction
  - `slides.py` with size, emptiness, and PDF header checks; pypdf per-page text
  - _Requirements: 1.2, 1.4_

- [x] 4. REST routes
  - [x] 4.1 Create session (JSON and PDF upload), session info, events backlog
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 4.2 STT token, question audio, report (v0 summary)
    - _Requirements: 5.1, 5.2, 6.4, 7.1, 7.2_

- [x] 5. WebSocket
  - [x] 5.1 Hello with optional backlog; unknown session closes with `4404`
    - _Requirements: 2.1, 2.2, 3.2_
  - [x] 5.2 Validate, dispatch under the session lock, ack or error with the echoed id
    - _Requirements: 2.3, 2.4, 2.5, 2.6_
  - [x] 5.3 Per-client queues, single writer, slow-client disconnect, cleanup on disconnect
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 6. Question audio
  - Synthesize on `hand_raised` / `qa_question`, cache by question id, record `question_audio` or `question_audio_failed`
  - _Requirements: 6.1, 6.2, 6.3_

- [x] 7. CORS and shutdown
  - `FRONTROW_CORS_ORIGINS`; lifespan closes sessions, settles audio tasks, then closes engines and model clients
  - _Requirements: 9.1, 9.2_

- [x] 8. Tooling and documentation
  - [x] 8.1 `python -m frontrow.fake_client` scripted browser
    - _Requirements: 10.1_
  - [x] 8.2 End-to-end REST + WebSocket check in `verify.py`
    - _Requirements: 10.2_
  - [x] 8.3 `docs/backend-interface.md` (endpoints, commands, events, flows, speech seams)
    - _Requirements: 8.3_

- [ ] 9. Full report
  - Slide x persona comprehension heatmap and ranked top fixes in `/report` (tracked in the orchestration spec, task 13)
  - _Requirements: 7.2_
