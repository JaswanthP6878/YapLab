# Implementation Plan

- [x] 1. Transport client
  - REST helpers and `connect()` with request/ack correlation, timeouts, reconnect with replay, `4404` handling; wire types in `protocol.js`
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 2. Event mapping and session state
  - Listener_Map, persona → avatar mapping, meters, room gauge, hand reducer, sequence and phase recovery from replay
  - _Requirements: 1.4, 3.2, 5.1_

- [x] 3. Speech input
  - [x] 3.1 Scribe controller with backend token, voice-activity commits, mic processing, increasing seq and spoken duration
    - _Requirements: 4.1, 4.2_
  - [x] 3.2 Ack-gated captions and muting during question playback
    - _Requirements: 4.3, 4.4_
  - [x] 3.3 Pin transcription to English with no secondary languages
    - _Requirements: 4.1_

- [x] 4. Question audio
  - FIFO playback, backend audio cache, playback messages, 5 s browser-speech fallback, autoplay recovery, voices toggle
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 5. Live session hook and controls
  - `useLiveSession`, `LiveControls` for call on, done answering, end talk, next question, finish
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 6.1, 6.6_

- [x] 6. Wire the Teaching room
  - [x] 6.1 Enable the bridge only for live Teaching; scope the "Backend live" label
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 6.2 `LIVE_SAY` so presenter text never resets backend-owned room state
    - _Requirements: 5.2_
  - [x] 6.3 Local-first slide changes with retained intent and resend after reconnect
    - _Requirements: 7.1, 7.2_
  - [x] 6.4 Live_Report_Envelope stored by App and reopened from Last report
    - _Requirements: 8.1, 8.2_

- [x] 7. Ambience
  - Room tone and throttled effects; sound URLs from `BASE_URL`
  - _Requirements: 9.1, 9.2_

- [x] 8. Diagnostics, bench, and tests
  - Bounded logs rendered only for the bench; `/live-test.html`; `npm run test:live`
  - Typed transcripts in the bench share the Scribe `seq` counter
  - Scripts and README adapted to the `frontend/` package layout with `vite.config.js` at the package root
  - _Requirements: 4.5, 10.1, 10.2, 10.3_

- [ ] 9. Keep the last sentence when calling on a hand
  - A final segment for speech that ended about 0.7 s before Call on can arrive during playback and be dropped; needs a backend change (see `hand-raise-and-answers` task 9)
  - _Requirements: 4.2, 4.4_

- [ ] 10. Custom live audiences
  - Support audience selection, question frequency, and seriousness instead of the fixed five-listener preset
  - _Requirements: 1.4_

- [ ] 11. Pause and cancel
  - Backend pause command and HTTP cancel endpoint so the live UI can pause and end sessions reliably
  - _Requirements: 6.6_
