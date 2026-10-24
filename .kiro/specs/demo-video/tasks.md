# Implementation Plan

- [x] 1. Script
  - Purpose → Design → Demo script with scene tables, frame ranges, captions, demo shot list, and recording notes in `docs/demo-video-script.md`
  - _Requirements: 1.1, 1.4, 4.3_

- [x] 2. Remotion project
  - `video/` package with exact Remotion 4.0.538, React 18.3.1, TypeScript; `YapLabIntro` at 1920×1080, 30 fps
  - Scene list with computed starts and total duration
  - _Requirements: 1.2, 1.3, 5.1_

- [x] 3. Look and feel
  - Palette and fonts from the app; the app's `Avatar`, `Icon`, and `PERSONAS` with a single-React webpack alias
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Purpose scenes
  - `Alone`, `Wall`, `Brand`, `ForWho`
  - _Requirements: 2.1_

- [x] 5. Design scenes
  - `Swarm`, `Personas`, `Orchestrator`, `Grounding`, `Moderator`, `Voices`, ending on a fade to the board color
  - _Requirements: 2.2, 2.3, 2.4_

- [x] 6. Captions
  - Caption band kept clear by `Stage`; `captions` prop and a no-captions render script
  - _Requirements: 4.1, 4.2_

- [x] 7. Docs and output
  - `video/README.md`; `video/join.sh` appends the demo (silence under the intro, demo scaled to 1080p30); `video/out/` ignored
  - _Requirements: 5.2_

- [x] 8. Logo and README banner
  - `docs/assets/yaplab-logo.svg` from the header mark; `Banner` still rendered with `npm run banner`; README header uses both
  - _Requirements: 3.4_

- [ ] 9. Final cut
  - Record the voice-over and the demo, join them with the Intro, and review the full 3 minutes
  - _Requirements: 1.1, 4.3_
