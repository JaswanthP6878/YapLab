# Implementation Plan

- [x] 1. Project scaffold
  - Vite + React app in `frontend/` with `package.json`, lockfile, and `vite.config.js` (React plugin) at the package root
  - Ignore `node_modules/` and `dist/` everywhere; generated output removed from tracking
  - _Requirements: 6.1, 6.2_

- [x] 2. Content model
  - Personas, Modes with Variants, Decks, checklists, and scripted replies in `data.js`; `defaultConfig` and carried fields in `lib/config.js`
  - _Requirements: 1.1, 1.2, 2.4_

- [x] 3. Screens
  - [x] 3.1 Home with Modes, Variants, and the sample report
    - _Requirements: 1.1, 1.4_
  - [x] 3.2 Setup with audience, seriousness, toggles, mode fields, and Deck upload
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 3.3 Interview coming-soon screen
    - _Requirements: 1.3_

- [x] 4. Room
  - [x] 4.1 Avatars with listening, confused, bored, hand, speaking, laughing, and noting states
    - _Requirements: 3.1_
  - [x] 4.2 Distraction-free layout; metrics kept for the report
    - _Requirements: 3.2_
  - [x] 4.3 Browser speech recognition, per-Persona speech synthesis, camera self-view, mic levels
    - _Requirements: 3.3, 3.4, 3.5_
  - [x] 4.4 Deck paging for built-in, PDF, and image decks
    - _Requirements: 3.6_

- [x] 5. Demo engine
  - Scripted session per Deck, reducer shared with backend events, "Simulated agents" label
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Report
  - Overall and category scores, pace, fillers, pauses, coverage, slide/answer breakdown, audience takeaways or judges' verdicts, next steps, moments, navigation
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 7. Interview mode practice
  - Replace the coming-soon screen with a working interview session
  - _Requirements: 1.3_

- [x] 8. Rename the product to YapLab in the UI
  - Tab titles (`index.html`, `live-test.html`), header chip, home hero, copy and footer, sample pitch deck, Pitch startup default and placeholder, test bench heading
  - Code, packages, `FRONTROW_*` settings, and docs unchanged
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
