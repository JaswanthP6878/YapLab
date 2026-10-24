# Requirements Document

## Introduction

This document specifies the web app in `frontend/`, presented to users as YapLab (the repository, packages, and code keep the FrontRow name): a React + Vite single-page application where a presenter picks a practice mode, configures an AI audience, presents in a distraction-free virtual room, and reviews a detailed report. Without a backend URL the app runs a scripted, in-browser simulation of the audience (demo mode), so the full experience can be shown and developed independently of the backend. Live backend sessions for Teaching are specified separately in the `live-teaching-bridge` spec.

## Glossary

- **App**: The React application in `frontend/`.
- **Product_Name**: "YapLab", the name shown to users.
- **Test_Bench**: The developer page `/live-test.html`.
- **Mode**: A practice type: Teaching, Pitch, or Interview.
- **Variant**: A preset within a Mode (for example Study group, Lecture rehearsal, Conference talk) with an audience, seriousness, deck, and optional time limit.
- **Persona**: An audience member with a name, role (student, judge, interviewer), trait, avatar look, and voice settings.
- **Demo_Engine**: The reducer and script in `lib/engine.js` that simulates the audience locally.
- **Deck**: The slides for a session: a built-in deck for the Variant or an uploaded PDF or image set.
- **Result**: The report data computed by the Demo_Engine at the end of a session.

## Requirements

### Requirement 1: Choosing a Practice

**User Story:** As a presenter, I want to pick what I am practicing, so that the audience fits the situation.

#### Acceptance Criteria

1. THE App SHALL offer the Teaching, Pitch, and Interview Modes on the home screen, each with its Variants.
2. WHEN a Variant is chosen, THE App SHALL preset its audience, seriousness, Deck, checklist, ambient noise, and time limit.
3. WHEN the Interview Mode is opened, THE App SHALL show a coming-soon screen with a way back.
4. THE App SHALL offer a sample report that can be opened without presenting.

### Requirement 2: Session Setup

**User Story:** As a presenter, I want to adjust the room before I start, so that practice matches my real audience.

#### Acceptance Criteria

1. THE App SHALL let the presenter choose audience members from the Mode's Personas, the seriousness, and whether camera, voices, and ambient noise are on.
2. THE App SHALL let the presenter enter mode-specific details: topic for Teaching; startup name, one-liner, and stage for Pitch.
3. THE App SHALL accept an uploaded PDF or image Deck and render its pages in the session.
4. WHEN the presenter switches Variants within a Mode, THE App SHALL keep the fields already entered.

### Requirement 3: The Room

**User Story:** As a presenter, I want a room that reacts like a real audience without distracting me, so that I can focus on presenting.

#### Acceptance Criteria

1. THE App SHALL show each audience member as an animated avatar whose state reflects listening, confusion, boredom, a raised hand, speaking, laughing, or note-taking.
2. THE App SHALL hide scores, tips, and the transcript while the presenter is presenting, measuring them for the report instead.
3. WHERE the browser supports speech recognition, THE App SHALL transcribe the presenter's microphone and react to what was said.
4. WHERE voices are on, THE App SHALL speak audience questions and replies with each Persona's voice settings.
5. WHERE the camera is on, THE App SHALL show the presenter's local self-view.
6. THE App SHALL let the presenter move between Deck pages.

### Requirement 4: Demo Mode

**User Story:** As a team member, I want the app to work without a backend, so that the UI can be built and demonstrated independently.

#### Acceptance Criteria

1. WHILE no backend URL is configured, THE App SHALL drive the audience with the Demo_Engine's scripted session for the chosen Deck.
2. THE App SHALL label sessions driven by the Demo_Engine as "Simulated agents".
3. THE Demo_Engine SHALL accept audience events through the same reducer interface that a backend connection uses.

### Requirement 5: Report

**User Story:** As a presenter, I want a clear review after I finish, so that I know what to improve.

#### Acceptance Criteria

1. WHEN a session ends, THE App SHALL show a report with an overall score and per-category scores.
2. THE report SHALL include pace over time, filler words, pauses, checklist coverage, and slide-by-slide (or answer-by-answer) results.
3. THE report SHALL include what each audience member took away or, for Pitch, the judges' verdicts.
4. THE report SHALL list the top things to work on next and key moments from the session.
5. THE App SHALL let the presenter practice again, start a new setup, or return home from the report.

### Requirement 6: Build and Repository Hygiene

**User Story:** As a developer, I want a standard Vite project, so that anyone can install and run it.

#### Acceptance Criteria

1. THE App SHALL install with `npm ci` and run with `npm run dev` and `npm run build` from `frontend/`.
2. THE repository SHALL ignore `node_modules/` and `dist/` and SHALL NOT track generated build output.

### Requirement 7: Product Name

**User Story:** As a presenter, I want the app to show one consistent name, so that the product feels finished.

#### Acceptance Criteria

1. THE App SHALL show the Product_Name in the browser tab title, the header, the home screen copy, and the footer.
2. THE App SHALL use the Product_Name in user-facing demo content, including the sample pitch deck and the default startup name in Pitch setup.
3. THE Test_Bench page SHALL show the Product_Name in its title and heading.
4. THE App SHALL keep the FrontRow name in code identifiers, package names, environment variables, and developer documentation.
