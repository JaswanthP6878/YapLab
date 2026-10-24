# Requirements Document

## Introduction

Each AI listener is a stateless model call made once per Tick; continuity exists only in what the backend puts back into the next prompt. This document specifies that carried state: a listener's recent reactions, the questions it has already raised and what happened to them, rolling notes on the whole talk so far shared by the room, and awareness of which slide is on screen. Together these let attention drift instead of resetting, stop listeners from repeating themselves, and let them connect what the Presenter says now to what was said minutes ago.

## Glossary

- **System**: The FrontRow backend.
- **Listener**: One AI student, holding a persona and its own memory for the lifetime of a Session.
- **Reaction_Memory**: A Listener's most recent Reactions (attention, confusion, one-line understanding).
- **Question_Memory**: The questions a Listener has raised, each with a status describing what happened to it.
- **Talk_Summary**: Short rolling notes on the whole talk so far, shared with every Listener.
- **Transcript_Window**: The latest stretch of the talk sent to Listeners each Tick (default 30 seconds).
- **Current_Slide**: The slide the Presenter has on screen, as last reported by the frontend.

## Requirements

### Requirement 1: Reaction Memory

**User Story:** As a Presenter, I want each student's attention to carry over between moments, so that losing the room builds up the way it does in a real class.

#### Acceptance Criteria

1. WHEN a Listener reacts, THE System SHALL include its most recent Reactions, up to the configured count (default 3), in its prompt, oldest first.
2. WHEN a Listener reacts for the first time, THE System SHALL state that this is the first stretch of the talk it has heard.
3. THE System SHALL instruct the Listener to keep its attention consistent, drifting gradually unless something changes.

### Requirement 2: Question Memory

**User Story:** As a Presenter, I want students not to ask me the same thing twice, so that their questions stay useful.

#### Acceptance Criteria

1. WHEN a Listener's question is raised or saved for Q&A, THE System SHALL add it to that Listener's Question_Memory with its status.
2. WHEN the question is called on, asked in Q&A, or judged, THE System SHALL update its status, including the Verdict and comment once judged.
3. WHEN a Listener reacts, THE System SHALL include its most recent questions, up to the configured count (default 5), with their statuses, and instruct it to ask only something new or follow up on an unsatisfying answer.
4. THE System SHALL include a Listener's Question_Memory only in that Listener's own prompt.

### Requirement 3: Rolling Talk Summary

**User Story:** As a Presenter, I want students to remember the whole talk, so that they can notice when I contradict myself or skip something I promised to explain.

#### Acceptance Criteria

1. WHEN a Tick completes and new speech has arrived since the last successful update, THE System SHALL fold that speech into the Talk_Summary with one model call.
2. THE System SHALL ask for notes under 150 words that keep, in order, topics, key claims, definitions, numbers, and anything the Presenter promised to explain later.
3. THE System SHALL run the update after recording `tick_complete`, so that the room score is not delayed.
4. WHEN a Listener reacts, THE System SHALL include the latest Talk_Summary in its prompt.
5. THE System SHALL cap the Talk_Summary at the configured length (default 1200 characters).
6. WHEN the Talk_Summary changes, THE System SHALL record a `talk_summary` event with the notes.
7. IF the update fails, THEN THE System SHALL keep the previous notes, record `summary_error`, and include the unsummarized speech in the next attempt.

### Requirement 4: Slide Awareness

**User Story:** As a Presenter, I want students to react to what is on screen, so that their questions match my slides.

#### Acceptance Criteria

1. WHEN the Presenter changes slides, THE System SHALL record the Current_Slide and a `slide_change` event.
2. WHILE a Current_Slide is set, THE System SHALL show Listeners the slides up to and including it, marking the Current_Slide as on screen.
3. THE System SHALL tag every Reaction and question with the Current_Slide, and include it in `tick_start`.
