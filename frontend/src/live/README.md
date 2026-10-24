# Live teaching bridge

The new bridge talks to the team backend directly. It does not use `lib/api.js`.
Provider credentials stay in the backend's ignored root `.env`; only a short-lived
Scribe token reaches the browser.

## Run

The voice backend (PR #1) is on `main`. From `apps/api`:

```sh
uv sync --extra elevenlabs --extra anthropic
FRONTROW_LLM=fake FRONTROW_TTS=elevenlabs FRONTROW_STT=elevenlabs FRONTROW_TICK_INTERVAL_SECONDS=5 uv run uvicorn frontrow.server:app --host 127.0.0.1 --port 8000
```

For Claude, set `FRONTROW_LLM=anthropic` and provide `ANTHROPIC_API_KEY` in that
backend root `.env`. Supply `ELEVENLABS_API_KEY` there for both voice providers.
The frontend needs no provider API keys.

From `frontend/`:

```sh
npm ci
# Put VITE_API_URL=http://127.0.0.1:8000 in frontend/.env.local (keep it untracked).
npm run dev:live -- --host 127.0.0.1
```

Open `/live-test.html` for the test bench or `/` for the product UI.
`npm run dev -- --host 127.0.0.1` is equivalent.

Use headphones. Start the session, enable audio, start the microphone, then speak
with pauses. Captions are committed only after `accepted: true`. The bench also
accepts typed transcripts through the same increasing sequence counter. Call on
a raised hand, wait for playback to end, answer, then choose Done answering. End
talk enters Q&A; Next question walks the pool; Finish retrieves the real report.
The browser can require an Enable audio click after an autoplay rejection.
Room ambience starts off in the bench and has its own checkbox. It is separate
from student question voices; silence until Call on / Next question is expected.

## Session wiring (separate commit)

The second commit only edits `screens/Session.jsx`. Its essential wiring is:

```jsx
const liveMode = Boolean(API_URL) && config.mode === 'teaching';
config = useMemo(() => liveMode ? makeLiveConfig(config) : config, [config, liveMode]);
const live = useLiveSession({ config: { ...config, voices }, enabled: liveMode,
  onTranscript: (text) => dispatch({ type: 'USER_SAY', text }),
  onAgentEvent: (event) => { const action = agentEventToAction(event); if (action) dispatch(action); },
});
const demoSpeech = useSpeechRecognition(respond);
const speech = liveMode ? live.speech : demoSpeech;
// respond: liveMode ? live.submitText(text) : existing demo behavior
// STEP effect: return immediately in liveMode
// Transcript speech effect: skip speak() in liveMode
// Slide navigation: live.setSlide(index), then update the existing page state
// Raised avatar: live.callOn(live.hands.find(hand => hand.agentId === id && hand.status === 'raised').questionId)
// End: live.endTalk(); Q&A controls use nextQuestion/answerDone/finishQA
// <LiveControls live={live} />; real report: <LiveReport report={live.report} onExit={onExit} />
```

Remove `VITE_API_URL` and restart Vite to use the unchanged scripted demo. Pitch
and interview remain scripted even with an API URL. The default live classroom
uses Alex, Maya, Ana, Sam and Priya, matching backend L0–L4. Configured custom
audiences, question frequency and seriousness are not supported by this preset.

## Boundaries and recovery

- PDF decks are fetched from the UI's blob URL and uploaded for text extraction.
  Image decks are rejected with a message rather than silently teaching from a
  different demo deck. With no upload, only slide titles and bullet points are
  sent, never the demo's scripted presenter lines.
- The backend owns meters, question grounding, answer verdicts, and delivery
  metrics. The product's live report renders that actual report; it does not
  fabricate the scripted engine's richer scores. The existing demo reducer still
  renders the room and keeps its local transcript; its hidden demo metrics are
  not used for the live report. Live reports are not saved into App's demo
  last-report storage because that would require changing another owned file.
- Reconnect requests a full replay, rebuilds hands/meters and advances sequence
  numbers without replaying old voices or room sounds. Pending requests reject
  rather than being resent. A backend restart loses in-memory sessions; leave
  and start another session when the bridge reports an unknown session.
- Active audio owns mic muting and backend playback messages; browser speech is
  the fallback on synthesis failure or a five-second missing-audio timeout.
  Turning voices off cancels audio; question text remains visible.
- A session closes through Q&A/reporting on exit. The backend has no HTTP cancel
  endpoint, so a severed socket during teardown cannot guarantee cancellation.
- The existing Pause control has no server pause equivalent; live wiring hides
  it. Camera is the teammate's local self-view only, with no visual analysis.
- The existing home badge uses the API URL globally, even though only Teaching
  is live. This bridge deliberately leaves that teammate-owned UI unchanged.

## Checks

```sh
npm run test:live
npm run build
```

`build:live` is also available. `frontend/dist` and `node_modules` are
git-ignored; never stage them. Tests cover transport correlation/replay, persona mapping,
Scribe sequence/duration and mute filtering, audio FIFO/fallback lifetime and
ambience throttles. Hardware microphone and audible voice quality require a
browser check; mocked SDK events alone do not establish them.
