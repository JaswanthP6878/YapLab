# Requirements Document

## Introduction

This document specifies how questions from the AI listeners reach the presenter and how the presenter's answers are judged. It extends the Moderator and Q&A requirements of the orchestration spec with a classroom-style floor: a listener raises a hand and waits to be called on; only one hand is up at a time; the presenter answers out loud; the listener who asked judges the answer and may ask one follow-up. It also specifies how the backend ingests the browser's speech-to-text output and ignores the agent's own voice while question audio plays.

## Glossary

- **System**: The FrontRow backend.
- **Presenter**: The human user giving the talk and answering questions.
- **Raised_Hand**: A grounded question waiting for the Presenter to call on it.
- **Active_Question**: The question currently being asked or answered after the Presenter called on it.
- **Floor**: The single slot held by a Raised_Hand or Active_Question; while it is held, no other hand goes up.
- **QA_Pool**: Grounded questions saved for the Q&A phase.
- **Answer**: The Presenter's transcript collected between calling on a question and closing it.
- **Verdict**: The asking listener's judgement of an Answer: `answered`, `partial`, or `dodged`.
- **Follow_Up**: A question the asking listener raises about its own Answer.
- **Final_Segment**: A finalized speech-to-text segment from the browser, identified by an increasing `seq`.
- **Playback_Window**: The time between `playback_started` and `playback_ended` for a question's audio.

## Requirements

### Requirement 1: One Hand Up at a Time

**User Story:** As a Presenter, I want at most one student waiting to interrupt me, so that the room behaves like a class instead of a flood of questions.

#### Acceptance Criteria

1. WHEN a Tick produces grounded questions and the Floor is free and the rate limit allows it, THE System SHALL raise exactly one of them as the Raised_Hand and add the rest to the QA_Pool.
2. WHILE the Floor is held, THE System SHALL add every new grounded question to the QA_Pool.
3. WHEN a hand is raised, THE System SHALL record a `hand_raised` event with the question id, listener, persona, spoken question, quote, and source.
4. IF a listener raises a question with the same quote as a question it already has held, THEN THE System SHALL drop the repeat.

### Requirement 2: Ranking Who Speaks

**User Story:** As a Presenter, I want the most useful question to get the floor, so that quieter or more confused students are heard.

#### Acceptance Criteria

1. THE System SHALL rank candidate questions first by how few times the asking listener has been called on, then by the listener's confusion, highest first.
2. WHEN candidates tie on both, THE System SHALL prefer the lowest listener id, comparing the numbers in ids numerically (`L2` before `L10`).
3. THE System SHALL produce the same choice for identical candidates across runs.

### Requirement 3: Calling On a Question

**User Story:** As a Presenter, I want to choose when to take a question, so that I am not interrupted mid-sentence.

#### Acceptance Criteria

1. WHEN the Presenter takes the Raised_Hand or a pooled question during the talk, THE System SHALL make it the Active_Question and record `question_taken`.
2. WHEN the Presenter takes a pooled question while another hand is raised, THE System SHALL lower the raised hand into the QA_Pool.
3. IF another question is still being answered, THEN THE System SHALL reject the request with an error.
4. IF the question id is unknown, THEN THE System SHALL reject the request with an error.
5. THE System SHALL measure the interruption rate limit (default 60 seconds) from the time a question was taken, not when it was raised.

### Requirement 4: Ignored Hands

**User Story:** As a Presenter, I want ignored questions saved rather than lost, so that I can answer them in Q&A.

#### Acceptance Criteria

1. WHEN a Raised_Hand has not been taken within the hand-raise timeout (default 45 seconds), THE System SHALL lower it into the QA_Pool and record `hand_lowered`.
2. WHEN the Presenter ends the talk while a hand is raised, THE System SHALL lower it into the QA_Pool.

### Requirement 5: Collecting the Answer

**User Story:** As a Presenter, I want my spoken answer captured, so that it can be judged.

#### Acceptance Criteria

1. WHILE an Active_Question is open, THE System SHALL append each accepted Final_Segment to its Answer and tag the stored transcript chunk with `answer_to`.
2. WHEN the Presenter reports the answer done, takes another question, asks for the next Q&A question, ends the talk, or ends Q&A, THE System SHALL close the open Answer, free the Floor, and record an `answer` event with the full text.

### Requirement 6: Judging the Answer

**User Story:** As a Presenter, I want to know whether I actually answered the question, so that I can practice handling questions.

#### Acceptance Criteria

1. WHEN an Answer closes, THE System SHALL ask the listener who asked to judge it and record an `answer_verdict` event with the Verdict and a one-sentence comment.
2. IF the Answer is empty, THEN THE System SHALL judge it `dodged` without calling the model.
3. IF the model returns a verdict other than `answered`, `partial`, or `dodged`, THEN THE System SHALL treat it as `partial`.
4. IF judging fails, THEN THE System SHALL record `answer_eval_error` and continue the session.

### Requirement 7: Follow-Up Questions

**User Story:** As a Presenter, I want a student to press me when my answer falls short, so that practice feels like a real class.

#### Acceptance Criteria

1. WHEN a Verdict includes a follow-up, THE System SHALL accept it only if its quote appears in the Answer, with source `answer`.
2. THE System SHALL allow at most one Follow_Up per original question.
3. WHEN the Floor is free, THE System SHALL raise the Follow_Up immediately without applying the rate limit; otherwise THE System SHALL add it to the QA_Pool.
4. THE System SHALL record the Follow_Up with `follow_up_of` set to the original question id.

### Requirement 8: Q&A Phase

**User Story:** As a Presenter, I want the best saved questions asked at the end, so that I can practice answering them.

#### Acceptance Criteria

1. WHEN the Presenter asks for the next Q&A question, THE System SHALL first close and judge the previous Answer, so that its Follow_Up can be asked next.
2. THE System SHALL ask a raised Follow_Up before any pooled question, without counting it toward the Q&A limit.
3. THE System SHALL ask pooled questions in ranking order until the pool is empty or the Q&A limit (default 5) is reached, recording `qa_question` for each.
4. WHEN no question remains, THE System SHALL report that Q&A is done.

### Requirement 9: Transcript Ingestion

**User Story:** As a frontend developer, I want a simple contract for speech-to-text output, so that browser and provider clocks never have to match the backend's.

#### Acceptance Criteria

1. THE System SHALL accept Final_Segments only while the session is presenting or in Q&A, and SHALL reject them with "session has ended" once ended.
2. WHEN a Final_Segment arrives, THE System SHALL stamp its end with the session clock's current time and its start with that time minus its duration, never earlier than the previous segment's end.
3. WHERE a Final_Segment has no duration, THE System SHALL estimate it at 2.5 words per second.
4. IF a Final_Segment repeats a `seq` already received, THEN THE System SHALL ignore it and report it as not accepted.
5. THE System SHALL ignore empty segments.

### Requirement 10: Echo Suppression

**User Story:** As a Presenter, I want the student's voice not mistaken for mine, so that the AI does not quote itself.

#### Acceptance Criteria

1. WHILE the Playback_Window is open, THE System SHALL drop incoming Final_Segments and record `transcript_dropped` with reason `agent_speaking`.
2. IF `playback_ended` is not received within the playback limit (default 30 seconds), THEN THE System SHALL accept input again.

### Requirement 11: Spoken Questions

**User Story:** As a Presenter, I want questions that sound natural when read aloud, so that the room feels real.

#### Acceptance Criteria

1. THE System SHALL ask listeners for a short spoken question (under 25 words) that does not read out the quote, separate from the quote used for grounding.
2. THE System SHALL send both the spoken question and the quote with every question event, so that the interface can speak one and show the other.
