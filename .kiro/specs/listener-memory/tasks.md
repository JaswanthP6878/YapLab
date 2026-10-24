# Implementation Plan

- [x] 1. Reaction memory in the prompt
  - Pass the last `listener_memory_ticks` reactions into `build_reaction_prompt`; first-stretch wording when empty
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Slide awareness
  - `Orchestrator.set_slide` / `current_slide`; slides shown up to the current one, marked on screen; `slide` on reactions, hands, and `tick_start`
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. Question memory
  - [x] 3.1 `Listener.questions` with `note_question` / `update_question`; config `listener_question_memory` (5)
    - _Requirements: 2.1, 2.3, 2.4_
  - [x] 3.2 Status updates from the Orchestrator (raised, pooled) and the Session (taken, asked in Q&A, judged, follow-ups)
    - _Requirements: 2.1, 2.2_

- [x] 4. Rolling talk summary
  - [x] 4.1 Summary prompt and Fake LLM support
    - _Requirements: 3.1, 3.2_
  - [x] 4.2 `Orchestrator._update_summary` after `tick_complete`, incremental over unsummarized speech, capped by `talk_summary_max_chars` (1200)
    - _Requirements: 3.1, 3.3, 3.5, 3.6_
  - [x] 4.3 Summary passed to every listener's next reaction
    - _Requirements: 3.4_
  - [x] 4.4 Failure keeps previous notes, records `summary_error`, retries the same speech
    - _Requirements: 3.7_

- [x] 5. Documentation and checks
  - Event catalog entries for `talk_summary` and `summary_error`; README "How it works"; `verify.py` checks for memory, summary, and question history
  - _Requirements: 1.1, 2.3, 3.4, 3.6_
