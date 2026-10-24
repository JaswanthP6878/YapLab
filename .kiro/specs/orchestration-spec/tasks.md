# Implementation Plan

- [x] 1. Core models, configuration, and clocks
  - Pydantic models for Slide, TranscriptChunk, Persona, Reaction, GroundedQuestion, HandRaise, TimelineEvent and SessionState in `models.py`
  - `Config` with validated tunables and `Config.from_env()`; reject tick intervals outside 1-300 s
  - `RealClock` reporting session-relative time and `SimulatedClock` with ordered waiters; reject negative advances
  - _Requirements: 3.2, 3.5, 4.2, 4.3, 5.1, 14.1, 14.2, 14.5_

- [x] 2. Time-windowed transcript buffer
  - `TranscriptBuffer.window(now, seconds)` returns chunks whose end falls in `[now - seconds, now]`, never chunks that end after `now`
  - _Requirements: 3.1, 3.3, 3.4_

- [x] 3. Personas and room presets
  - Six personas with attention/confusion biases and question propensity; presets `default` (5), `full_room` (8), `lecture_hall` (10)
  - `build_room()` rejects unknown presets and sizes outside 5-12 and assigns ids `L0`, `L1`, ...
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 4. LLM client abstraction and deterministic Fake LLM
  - `LLMClient.complete` / `complete_json` with tolerant JSON extraction
  - `FakeLLM` producing hash-derived, grounded reactions with no network access
  - _Requirements: 13.1, 13.2, 13.3_

- [x] 5. Listener agents and grounding
  - [x] 5.1 `Listener.react()` builds the prompt, applies persona biases, clamps 0-100, updates memory
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x] 5.2 Grounding: quoted span of at least 10 characters found in the transcript window or a slide, with source `transcript` or `slide:N`; the exact source text is stored
    - _Requirements: 8.1, 8.3_
  - [x] 5.3 Drop ungrounded questions, keep the reaction, and record `grounding_rejected`
    - _Requirements: 8.2_

- [x] 6. Moderator
  - Deterministic selection, rate limit (default 60 s), and lossless Q&A pool; extended by the `hand-raise-and-answers` spec
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 7. Orchestrator tick loop
  - [x] 7.1 Concurrent fan-out with a per-listener timeout raced on the Clock
    - _Requirements: 4.1, 4.4, 4.5, 4.6, 4.7, 5.1_
  - [x] 7.2 Isolate timeouts (`listener_timeout`) and failures (`listener_error`); always complete the tick
    - _Requirements: 5.2, 5.3, 5.4_
  - [x] 7.3 Backpressure: at most one tick in flight; record `skipped_tick` at an overrun boundary
    - _Requirements: 5.5, 5.6_
  - [x] 7.4 Stop starting ticks when the session leaves Presenting
    - _Requirements: 4.8, 10.3_

- [x] 8. Session lifecycle and Q&A
  - `Session` state machine with permitted transitions only; reject transcript input after the session ends
  - Q&A draws from the pool and surfaces each question with its quote and asker
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 10.1, 10.2, 10.4_

- [x] 9. Timeline recording
  - Every event carries a Clock timestamp; events are kept in nondecreasing order and streamed to clients
  - [ ] 9.1 Record slide upload (PDF ingestion) itself as a timeline event; slide changes are recorded today
  - _Requirements: 11.1, 11.2, 11.3_

- [x] 10. Fallback for the real LLM client
  - `FallbackLLM` answers from `FakeLLM` on error, unparseable output, or timeout (default 30 s) and records `llm_fallback`
  - Note: the request deadline uses asyncio wall time because it bounds real network I/O; everything else uses the Clock
  - _Requirements: 13.4, 13.5, 13.6, 14.1_

- [x] 11. Slide ingestion
  - PDF upload to per-page text with pypdf; empty, oversized (> 100 MB), and non-PDF uploads rejected; empty pages kept as empty slides
  - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.4_

- [x] 12. Server endpoints and protocol
  - REST for sessions, uploads, STT tokens, audio, report; per-session WebSocket with typed messages; detailed in the `session-server` spec
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_

- [ ] 13. Report
  - [x] 13.1 v0 summary from the timeline: room score per tick, answer verdict counts, delivery statistics
    - _Requirements: 12.1, 12.3_
  - [ ] 13.2 Comprehension heatmap indexed by slide and persona, marking slides with no reactions as unavailable
    - _Requirements: 12.2, 12.5_
  - [ ] 13.3 Ranked list of top fixes for the presenter
    - _Requirements: 12.4_

- [x] 14. Determinism and offline verification
  - Identical timelines across replays with `SimulatedClock` + `FakeLLM`; `verify.py` covers the requirements above
  - _Requirements: 13.2, 14.3, 14.4_
