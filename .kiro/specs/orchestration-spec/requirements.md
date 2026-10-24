# Requirements Document

## Introduction

This document specifies the requirements for the FrontRow backend and its Orchestrator, treated as a single spec. FrontRow is a practice classroom populated by AI students. A Presenter uploads slides as a PDF and speaks into a microphone; the browser performs speech-to-text and streams the resulting Transcript to the backend. The backend runs a tick loop in which the Orchestrator, every configured Tick interval, sends the latest window of the live Transcript to every AI Listener at once. Each Listener returns its Attention, Confusion, understanding, and optionally a Question. A Moderator selects at most one Interruption per Tick and pools the remaining Questions for a later Q&A phase. Every Question an agent asks must quote actual Transcript or Slide content (Grounding). A Recorder maintains a Timeline of every event. At the end of a Session, Listeners ask their best pooled Questions, then a Report produces a per-Slide and per-Persona comprehension Heatmap along with delivery statistics and top fixes.

The backend is implemented in Python using asyncio. It exposes REST and WebSocket endpoints that stream Session events to the frontend using a shared protocol schema. A deterministic Fake LLM supports offline tests and acts as a fallback when the real LLM client errors or times out. A Clock abstraction (real or simulated) makes replay and tests deterministic.

This spec covers Session lifecycle, Slide ingestion, Transcript ingestion and buffering, the Orchestrator tick loop and fan-out, Listener agents and Personas, Grounding, the Moderator, the Q&A phase, the Recorder, the Report, the LLM client abstraction, the Clock abstraction, and the Server. Frontend behavior, browser speech-to-text, and PDF rendering in the client are out of scope except where the backend contract requires them.

## Glossary

- **System**: The FrontRow backend and Orchestrator described by this document.
- **Session**: A single practice run, from Slide upload through the final Report, identified by a unique Session identifier.
- **Session_State**: The lifecycle state of a Session, one of Idle, Presenting, QA, Reporting, or Ended.
- **Presenter**: The human user who uploads Slides and speaks during a Session.
- **Slide**: One page of the uploaded presentation, holding extracted per-Slide text and an ordinal index.
- **Transcript**: The ordered sequence of recognized speech text for a Session.
- **TranscriptChunk**: A single unit of recognized speech text with a start time, an end time, and text content.
- **Transcript_Buffer**: A time-windowed buffer that stores TranscriptChunks and returns the most recent window on request.
- **Tick**: One iteration of the Orchestrator tick loop.
- **Tick_Interval**: The configured duration between consecutive Ticks, defaulting to 15 seconds.
- **Orchestrator**: The component that runs the tick loop, fans out the current Transcript window to all Listeners, and collects their Reactions.
- **Listener** (also **Agent**): One AI student participant that observes the Transcript window and produces a Reaction. A Listener has an assigned Persona, per-agent memory, and trait adjustments.
- **Persona**: A named definition of a Listener's disposition and behavior (for example confused first-year, skeptical professor, ESL student, distracted student, domain expert).
- **Room_Preset**: A named selection of Personas that composes a room of between 5 and 12 Listeners.
- **Reaction**: A Listener's response for a Tick, containing Attention, Confusion, an understanding summary, and an optional Question.
- **Attention**: A numeric measure in the range 0 to 100 indicating how focused a Listener is during a Tick.
- **Confusion**: A numeric measure in the range 0 to 100 indicating how confused a Listener is during a Tick.
- **Question**: Text a Listener wishes to ask the Presenter, which must satisfy Grounding.
- **HandRaise**: A record that a Listener has a Question available to be asked, carrying the Question and the originating Listener.
- **Grounding**: The rule that every Question must quote a span of actual Transcript or Slide content.
- **Moderator**: The component that selects at most one Interruption per Tick, applies rate limiting, and pools non-selected Questions for the Q&A phase.
- **Interruption**: A single HandRaise selected by the Moderator to be surfaced to the Presenter during a Tick.
- **QA_Pool**: The collection of pooled HandRaises deferred for the Q&A phase.
- **Q&A phase**: The Session phase after Presenting in which Listeners ask their best pooled Questions.
- **Recorder**: The component that records every Session event with a timestamp into the Timeline.
- **Timeline**: The ordered, timestamped record of all Session events.
- **Report**: The end-of-Session artifact containing a per-Slide and per-Persona comprehension Heatmap, delivery statistics, and top fixes.
- **Heatmap**: A grid of comprehension values indexed by Slide and by Persona.
- **LLM_Client**: The abstraction that produces model responses for Reactions, Questions, and Report content.
- **Fake_LLM**: A deterministic implementation of the LLM_Client used for offline tests, replay, and as a fallback.
- **Clock**: The abstraction that provides the current time and sleeping, in either a real or simulated implementation.
- **WebSocket_Event**: A structured message, conforming to the shared protocol schema, streamed from the Server to a connected client.
- **Protocol_Schema**: The shared source-of-truth schema describing client and Server messages.

## Requirements

### Requirement 1: Session Lifecycle

**User Story:** As a Presenter, I want a Session to progress through clear phases from upload to Report, so that I can practice a full presentation and receive feedback.

#### Acceptance Criteria

1. WHEN a Presenter uploads Slides for a new Session, THE System SHALL create a Session with a globally unique Session identifier and set its Session_State to Idle within 2 seconds of receiving the upload.
2. IF a Presenter uploads Slides where the file is empty, exceeds 100 MB, or is not a supported Slides format, THEN THE System SHALL reject the upload, not create a Session, and return an error response indicating the specific validation failure.
3. WHEN a Presenter starts a Session that is in Session_State Idle, THE System SHALL set the Session_State to Presenting.
4. WHEN a Presenter ends the Presenting phase of a Session that is in Session_State Presenting, THE System SHALL set the Session_State to QA.
5. WHEN the Q&A phase of a Session that is in Session_State QA completes, THE System SHALL set the Session_State to Reporting.
6. WHEN the Report for a Session that is in Session_State Reporting has been produced, THE System SHALL set the Session_State to Ended.
7. IF a Presenter requests a phase transition that is not one of the permitted transitions (Idle to Presenting, Presenting to QA, QA to Reporting, Reporting to Ended) from the current Session_State, THEN THE System SHALL reject the request, leave the Session_State unchanged, and return an error response indicating the requested transition is not permitted from the current Session_State.
8. WHILE a Session is in Session_State Ended, THE System SHALL reject requests to ingest TranscriptChunks for that Session, retain the existing TranscriptChunks unchanged, and return an error response indicating the Session has ended.

### Requirement 2: Slide Ingestion

**User Story:** As a Presenter, I want my uploaded PDF converted into per-Slide text, so that Listeners and Grounding can reference what is shown on each Slide.

#### Acceptance Criteria

1. WHEN a Presenter uploads a PDF for a Session, THE System SHALL extract the text of each page into a Slide with a zero-based ordinal index preserving page order.
2. WHEN Slide extraction completes for a Session, THE System SHALL store the ordered collection of Slides for that Session.
3. IF the uploaded file cannot be parsed as a PDF, THEN THE System SHALL reject the upload and return a descriptive error.
4. IF a page of the uploaded PDF contains no extractable text, THEN THE System SHALL store a Slide with empty text content at that page index.

### Requirement 3: Transcript Ingestion and Time-Windowed Buffer

**User Story:** As a Presenter, I want my spoken words captured and time-windowed, so that Listeners react to the most recent part of my talk.

#### Acceptance Criteria

1. WHEN the System receives a TranscriptChunk for a Session in Session_State Presenting, THE System SHALL append the TranscriptChunk to the Transcript_Buffer for that Session.
2. THE Transcript_Buffer SHALL store each TranscriptChunk with its start time, end time, and text content.
3. WHEN the Orchestrator requests the current Transcript window for a Session, THE Transcript_Buffer SHALL return the TranscriptChunks whose end time falls within the configured window duration measured backward from the current Clock time.
4. WHERE the configured window duration exceeds the elapsed Session time, THE Transcript_Buffer SHALL return all TranscriptChunks received for the Session.
5. IF a TranscriptChunk is received with an end time earlier than its start time, THEN THE System SHALL reject the TranscriptChunk and return a descriptive error.

### Requirement 4: Orchestrator Tick Loop and Fan-Out

**User Story:** As a Presenter, I want the room to react to my talk at a steady cadence, so that the classroom feels alive while I present.

#### Acceptance Criteria

1. WHILE a Session is in Session_State Presenting, THE Orchestrator SHALL start a new Tick every Tick_Interval as measured by the Clock, such that the Clock time between the start of consecutive Ticks differs from the configured Tick_Interval by no more than 500 milliseconds.
2. THE Orchestrator SHALL use a default Tick_Interval of 15 seconds when no Tick_Interval is configured.
3. IF a configured Tick_Interval is less than 1 second or greater than 300 seconds, THEN THE Orchestrator SHALL reject the configuration with a descriptive error and SHALL retain the default Tick_Interval of 15 seconds.
4. WHEN a Tick starts, THE Orchestrator SHALL request the current Transcript window from the Transcript_Buffer and send that window to every Listener in the Session.
5. WHEN a Tick starts, THE Orchestrator SHALL dispatch the Transcript window to all Listeners concurrently, such that the dispatch to any Listener does not wait for any other Listener's Reaction to be produced.
6. WHEN a Tick starts and the Session contains zero Listeners, THE Orchestrator SHALL complete the Tick without sending any Transcript window and SHALL collect zero Reactions.
7. WHEN a Tick completes, THE Orchestrator SHALL collect the Reaction of every Listener that returned a Reaction within the per-Listener timeout.
8. WHEN the Session_State leaves Presenting, THE Orchestrator SHALL stop starting new Ticks for that Session.

### Requirement 5: Listener Timeout, Failure Isolation, and Backpressure

**User Story:** As a Presenter, I want one slow or failing Listener to not freeze the room, so that the room keeps reacting on schedule.

#### Acceptance Criteria

1. WHEN the Orchestrator sends a Transcript window to a Listener, THE Orchestrator SHALL apply a configured per-Listener timeout to that Listener's Reaction, defaulting to 10 seconds when no per-Listener timeout is configured, and the configured per-Listener timeout SHALL be strictly less than the Tick_Interval.
2. IF a Listener does not return a Reaction within the per-Listener timeout, THEN THE Orchestrator SHALL exclude that Listener's Reaction from the current Tick, continue the current Tick with the remaining Reactions, and record a Listener-timeout event identifying the excluded Listener.
3. IF a Listener raises an error while producing a Reaction, THEN THE Orchestrator SHALL exclude that Listener's Reaction from the current Tick, continue the current Tick with the remaining Reactions, and record a Listener-failure event identifying the excluded Listener.
4. IF every Listener in the Session is excluded from the current Tick by timeout or error, THEN THE Orchestrator SHALL complete the current Tick with zero collected Reactions rather than blocking until the per-Listener timeout of the next Tick.
5. IF a Tick is still running when the next Tick is due as measured by the Clock, THEN THE Orchestrator SHALL skip starting the due Tick and record a skipped-Tick event.
6. THE Orchestrator SHALL process at most one Tick at a time per Session.

### Requirement 6: Listener Agent Reaction

**User Story:** As a Presenter, I want each AI student to tell me how focused and confused it is and what it understood, so that I learn how different listeners follow my talk.

#### Acceptance Criteria

1. WHEN a Listener receives a Transcript window, THE Listener SHALL return a Reaction containing an Attention value, a Confusion value, an understanding summary, and an optional Question.
2. THE Listener SHALL return each Attention value as a number in the range 0 to 100 inclusive.
3. THE Listener SHALL return each Confusion value as a number in the range 0 to 100 inclusive.
4. WHEN a Listener produces a Reaction, THE Listener SHALL update its per-agent memory with the Transcript window and its own Reaction.
5. WHEN a Listener produces a Reaction, THE Listener SHALL apply its Persona trait adjustments to the Attention value and the Confusion value.
6. WHERE a Listener has no Question for a Tick, THE Listener SHALL return a Reaction with no Question.

### Requirement 7: Personas and Room Presets

**User Story:** As a Presenter, I want a room of distinct AI students, so that I see how different kinds of listeners respond.

#### Acceptance Criteria

1. THE System SHALL define each Persona with a name and the trait adjustments that influence Attention, Confusion, and Question behavior.
2. WHEN a Session is created from a Room_Preset, THE System SHALL instantiate between 5 and 12 Listeners inclusive, each assigned a Persona from that Room_Preset.
3. IF a Room_Preset would instantiate fewer than 5 Listeners or more than 12 Listeners, THEN THE System SHALL reject the Room_Preset and return a descriptive error.
4. THE System SHALL assign each Listener in a Session a distinct Listener identifier.

### Requirement 8: Grounding

**User Story:** As a Presenter, I want every question to quote something I actually said or showed, so that the room's questions stay honest and relevant.

#### Acceptance Criteria

1. WHEN a Listener produces a Question, THE System SHALL verify that the Question contains a quoted span of at least 10 characters that exactly matches a contiguous substring of either the Session's Transcript content or the text content of a Slide for the Session.
2. IF a Question does not contain a quoted span of at least 10 characters that exactly matches a contiguous substring of the Session's Transcript content or a Slide's text content, THEN THE System SHALL reject the Question, exclude it from the current Tick and the QA_Pool, and record a grounding-rejection event indicating the Question failed Grounding.
3. WHEN the System accepts a Question, THE System SHALL retain, together with the Question, the exact quoted span and an identifier of its source indicating whether the span came from the Transcript or from a specific Slide index.

### Requirement 9: Moderator

**User Story:** As a Presenter, I want a moderator to decide who interrupts me, so that the room behaves like a class instead of a flood of questions.

#### Acceptance Criteria

1. WHEN a Tick produces two or more grounded HandRaises and the configured Interruption rate limit has not been reached, THE Moderator SHALL select exactly one HandRaise as the Interruption for that Tick using a deterministic selection rule that yields the same Interruption for identical sets of grounded HandRaises across runs.
2. WHEN a Tick produces exactly one grounded HandRaise and the configured Interruption rate limit has not been reached, THE Moderator SHALL select that HandRaise as the Interruption for that Tick.
3. WHEN the Moderator selects an Interruption for a Tick, THE Moderator SHALL add every grounded HandRaise from that Tick that was not selected as the Interruption to the QA_Pool and SHALL retain every such HandRaise with no loss.
4. THE Moderator SHALL apply a default Interruption rate limit of at most 1 Interruption per 60 seconds, measured by the Clock, when no Interruption rate limit is configured.
5. IF the configured Interruption rate limit has been reached when a Tick produces one or more grounded HandRaises, THEN THE Moderator SHALL select no Interruption for that Tick and SHALL add all grounded HandRaises from that Tick to the QA_Pool.
6. WHEN a Tick produces no grounded HandRaises, THE Moderator SHALL select no Interruption for that Tick.

### Requirement 10: Q&A Phase

**User Story:** As a Presenter, I want the room to ask its best questions at the end, so that I can practice answering them.

#### Acceptance Criteria

1. WHEN a Session enters Session_State QA, THE System SHALL draw Questions from the QA_Pool for Listeners to ask.
2. WHEN a Listener asks a Question during the Q&A phase, THE System SHALL surface the Question together with its quoted span and the asking Listener.
3. WHILE a Session is in Session_State QA, THE System SHALL stop producing new Ticks for that Session.
4. WHEN the QA_Pool for a Session is empty during the Q&A phase, THE System SHALL allow the Q&A phase to complete.

### Requirement 11: Recorder and Timeline

**User Story:** As a developer, I want every event recorded on a timeline, so that I can replay, debug, and build the Report.

#### Acceptance Criteria

1. WHEN any Session event occurs, THE Recorder SHALL append the event to the Timeline with a timestamp taken from the Clock.
2. THE Recorder SHALL record Slide ingestion, TranscriptChunk ingestion, Tick start, Reactions, selected Interruptions, pooled HandRaises, Q&A Questions, skipped Ticks, and Session_State transitions.
3. THE Recorder SHALL preserve events in the Timeline in nondecreasing timestamp order.

### Requirement 12: Report

**User Story:** As a Presenter, I want a per-slide and per-persona comprehension report, so that I know who I lost and where.

#### Acceptance Criteria

1. WHEN a Session enters Session_State Reporting, THE System SHALL produce a Report from the Timeline.
2. THE Report SHALL contain a Heatmap of comprehension values indexed by Slide and by Persona.
3. THE Report SHALL contain delivery statistics derived from the Transcript and the Timeline.
4. THE Report SHALL contain a ranked list of top fixes for the Presenter.
5. WHERE a Slide received no Reactions during the Session, THE Report SHALL mark the comprehension value for that Slide as unavailable.

### Requirement 13: LLM Client Abstraction and Fake LLM

**User Story:** As a developer, I want a deterministic fake model for tests and a safe fallback in production, so that the system runs offline and degrades gracefully.

#### Acceptance Criteria

1. THE System SHALL access all model responses through the LLM_Client abstraction.
2. WHEN the System receives a request configured to use the Fake_LLM, THE LLM_Client SHALL return byte-for-byte identical responses for identical input content and identical configuration parameters.
3. WHERE the System is configured to use the Fake_LLM, THE LLM_Client SHALL make no outbound network calls.
4. IF the real LLM_Client returns an error, THEN THE System SHALL obtain the response from the Fake_LLM for that request and return it to the caller as a successful result.
5. IF the real LLM_Client does not respond within the configured timeout, defaulting to 30 seconds when none is configured, THEN THE System SHALL cancel the pending request and obtain the response from the Fake_LLM for that request.
6. WHEN the System obtains a response from the Fake_LLM as a fallback, THE System SHALL record a fallback event identifying the request that fell back.

### Requirement 14: Clock Abstraction

**User Story:** As a developer, I want a swappable clock, so that replay and tests are deterministic and fast.

#### Acceptance Criteria

1. THE System SHALL obtain the current time and perform all delay and waiting operations exclusively through the Clock abstraction, with no direct calls to wall-clock time sources.
2. WHERE the System is configured with the simulated Clock, THE Clock SHALL advance its reported time only in response to an explicit advance instruction, and SHALL advance by exactly the requested duration.
3. WHERE the System is configured with the simulated Clock, WHEN the Orchestrator schedules a Tick, THE Orchestrator SHALL start that Tick based on the simulated Clock's reported time rather than wall-clock time.
4. WHEN the same scenario is replayed two or more times with the simulated Clock and the Fake_LLM, THE System SHALL produce Timelines that are identical in event ordering, event timestamps, and event content across all runs.
5. IF an advance instruction specifies a duration less than zero, THEN THE System SHALL reject the instruction, leave the simulated Clock's reported time unchanged, and return an error indicating that time cannot move backward.

### Requirement 15: Server REST and WebSocket Endpoints

**User Story:** As a frontend developer, I want REST and WebSocket endpoints that stream session events, so that the web app can drive and display a live session.

#### Acceptance Criteria

1. THE Server SHALL expose REST endpoints to upload Slides, create a Session, start a Session, and request the Report.
2. WHEN a client requests the Report for a Session that has not yet completed, THE Server SHALL reject the request and return an error response indicating the Report is not yet available.
3. WHEN a client connects to the Session WebSocket with a valid Session identifier, THE Server SHALL stream WebSocket_Events for that Session to the client.
4. IF a client connects to the Session WebSocket with a Session identifier that does not correspond to an existing Session, THEN THE Server SHALL reject the connection and return an error response indicating the Session was not found, without streaming any WebSocket_Event.
5. THE Server SHALL format every WebSocket_Event to conform to the Protocol_Schema.
6. WHEN a WebSocket client disconnects, THE Server SHALL stop sending WebSocket_Events to that client within 5 seconds and release all resources allocated to that client connection.
7. IF a client sends a message over the WebSocket that does not conform to the Protocol_Schema, THEN THE Server SHALL reject the message and return an error response identifying the validation failure, while retaining the existing WebSocket connection.
8. WHEN a Session event is recorded on the Timeline, THE Server SHALL stream a corresponding WebSocket_Event conforming to the Protocol_Schema to every client currently connected for that Session.
