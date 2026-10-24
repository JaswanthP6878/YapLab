# Implementation Plan

- [x] 1. Extend the data models
  - `HandRaise` gains `question_id`, `persona`, `confusion`, `tick`, `slide`, `follow_up_of`; add `AnswerVerdict`
  - Config: `hand_raise_timeout_seconds` (45), `playback_max_seconds` (30), `qa_max_questions` (5)
  - _Requirements: 1.3, 4.1, 8.3, 10.2_

- [x] 2. Moderator floor and ranking
  - [x] 2.1 Single Floor slot; pool everything while it is held; drop same-listener same-quote repeats
    - _Requirements: 1.1, 1.2, 1.4_
  - [x] 2.2 Ranking by times called, then confusion, then numeric-aware listener id
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 2.3 `take`, `resolve`, `expire`, `lower`; rate limit measured from the take
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2_
  - [x] 2.4 `next_qa` with follow-up priority and the Q&A limit
    - _Requirements: 8.2, 8.3, 8.4_

- [x] 3. Orchestrator events
  - Question ids `q1`, `q2`, ...; `hand_raised`, `pooled`, `hand_lowered` with full hand fields
  - _Requirements: 1.3, 4.1, 11.2_

- [x] 4. Session inputs
  - [x] 4.1 `ingest_transcript`: state checks, backend clock stamping, duration estimate, seq dedupe, empty segments ignored
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 4.2 Echo suppression during playback with the auto-release
    - _Requirements: 10.1, 10.2_
  - [x] 4.3 `take_question`, `answer_done`, answer collection tagged with `answer_to`, closing rules
    - _Requirements: 3.1, 3.3, 3.4, 5.1, 5.2_
  - [x] 4.4 Q&A: `end_presenting` lowers the raised hand; `next_qa_question` judges the previous answer first
    - _Requirements: 4.2, 8.1_

- [x] 5. Answer judging and follow-ups
  - [x] 5.1 `Listener.evaluate_answer` with the answer prompt, verdict normalization, empty-answer shortcut
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 5.2 Background evaluation with `answer_verdict` / `answer_eval_error` events
    - _Requirements: 6.1, 6.4_
  - [x] 5.3 Follow-ups grounded against the answer, one per question, raised or pooled
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 6. Spoken questions
  - Reaction prompt asks for a short spoken question separate from the quote; Fake LLM uses persona-flavoured templates
  - _Requirements: 11.1, 11.2_

- [x] 7. Replay and offline checks
  - Replay drives a `Session` with scripted Q&A answers; `verify.py` checks for every requirement above
  - _Requirements: 1.1, 3.5, 6.1, 8.1, 9.2, 10.1_

- [ ] 8. Merge similar questions across listeners
  - Count a near-duplicate question from another listener as a vote for the held question instead of a separate entry (deferred)
  - _Requirements: 1.4, 2.1_

- [ ] 9. Accept late final segments that belong to the presenter
  - A final segment for speech that ended just before `take_question` can arrive during playback and be dropped; needs coordination with the frontend bridge
  - _Requirements: 10.1_
