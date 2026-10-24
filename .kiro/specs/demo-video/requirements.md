# Requirements Document

## Introduction

This document specifies the 3-minute YapLab video. The video follows the order Purpose → Design → Demo. Purpose and Design are an animated intro built with Remotion in `video/`; the Demo is a screen recording of a live teaching session appended after it. The script in `docs/demo-video-script.md` is the narrative source, and `video/src/scenes.ts` holds the intro's timing and captions.

## Glossary

- **Intro**: The `YapLabIntro` Remotion composition covering Purpose and Design.
- **Scene**: One timed segment of the Intro with its own animation and caption.
- **Caption**: The voice-over line for a Scene, burned into the frame.
- **Demo**: The screen recording of a live teaching session, appended after the Intro.
- **Script**: `docs/demo-video-script.md`.

## Requirements

### Requirement 1: Structure and Timing

**User Story:** As a judge, I want a short video that explains why, how, and then shows it working, so that I understand the project in three minutes.

#### Acceptance Criteria

1. THE video SHALL run Purpose (0:00–0:40), Design (0:40–1:30), and Demo (1:30–3:00), in that order.
2. THE Intro SHALL be 1920×1080 at 30 fps and exactly 90 seconds long.
3. THE Intro SHALL derive each Scene's start and the total duration from one ordered list of Scenes, so that changing a Scene's length moves every later Scene.
4. THE Script SHALL list every Scene with its time range, frame range, visuals, and voice-over, matching the Intro.

### Requirement 2: Content

**User Story:** As a judge, I want the intro to explain the important parts accurately, so that the demo makes sense.

#### Acceptance Criteria

1. THE Purpose part SHALL show the problem (rehearsing alone), the product and its tagline, and who it is for.
2. THE Design part SHALL show the five listener personas and their memory, the orchestrator's parallel 15-second tick, grounding with an accepted and a rejected question, the moderator's warm-up, single raised hand, and Q&A pool, and the voice and transcription path.
3. THE Intro SHALL describe only behavior the app actually has.
4. THE Intro SHALL end by fading to the app's background color for a clean cut to the Demo.

### Requirement 3: Visual Consistency

**User Story:** As a viewer, I want the intro to look like the app, so that the cut to the demo feels continuous.

#### Acceptance Criteria

1. THE Intro SHALL use the app's palette and fonts.
2. THE Intro SHALL draw the students with the app's own `Avatar` and `Icon` components and `PERSONAS` data, imported from `frontend/src`.
3. THE Intro SHALL render with a single React instance even though it imports components from the frontend.
4. THE repository SHALL include the app's logo as `docs/assets/yaplab-logo.svg` and a README banner rendered from the same components and fonts.

### Requirement 4: Captions and Voice-Over

**User Story:** As a viewer watching muted, I want captions, so that I can follow the narration.

#### Acceptance Criteria

1. THE Intro SHALL show each Scene's voice-over line as a Caption in a band that the Scene's content keeps clear of.
2. WHERE the `captions` prop is false, THE Intro SHALL render without Captions.
3. THE voice-over SHALL stay near 140 spoken words per minute.

### Requirement 5: Producing the Video

**User Story:** As a developer, I want simple commands, so that I can preview, render, and assemble the video quickly.

#### Acceptance Criteria

1. THE `video/` package SHALL provide scripts to preview, render with and without captions, and render a still frame.
2. THE repository SHALL document how to record the Demo and join it to the Intro, and SHALL ignore rendered output.
