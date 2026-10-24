# Live teaching bridge

The bridge connects the Teaching UI to the backend on `main`. Its contract is
[docs/backend-interface.md](../../../docs/backend-interface.md); `lib/api.js`
is an older draft contract and is not used here. Provider credentials stay in
the backend's ignored root `.env`; only a short-lived Scribe token reaches the
browser.

## Run

From the repository root, create `.env` from `.env.example` if needed. For live
Claude and ElevenLabs, set these values there:

```dotenv
FRONTROW_LLM=anthropic
ANTHROPIC_API_KEY=your_claude_key
FRONTROW_LLM_MODEL=
FRONTROW_TTS=elevenlabs
FRONTROW_STT=elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_key
```

Start the backend from `apps/api`:

```sh
cd apps/api
uv sync --extra elevenlabs --extra anthropic
uv run uvicorn frontrow.server:app --env-file ../../.env --host 127.0.0.1 --port 8000
```

The default tick interval is 15 seconds. Leave `FRONTROW_TICK_INTERVAL_SECONDS`
unset to use it. For an offline LLM with real voice, prefix the server command
with `FRONTROW_LLM=fake`. The frontend needs no provider API keys.

In a second terminal, from the repository root:

```sh
cd frontend
npm ci
# Create .env.local here with VITE_API_URL=http://127.0.0.1:8000 (keep it untracked).
npm run dev
```

Vite loads `frontend/vite.config.js`. Open `/` for the product UI or
`/live-test.html` for the test bench. Remove `VITE_API_URL` and restart Vite for
the scripted demo. Only Teaching uses the live backend; Pitch and Interview
keep their demo behavior even when an API URL is configured.

Use headphones. Start a session, enable audio, start the microphone, then speak
with pauses. Final captions appear only after a transcript ack has
`accepted: true`. The bench also accepts typed transcripts through the same
increasing sequence counter. Call on a raised hand, wait for playback to end,
answer, then choose Done answering. End talk enters Q&A; Next question walks
the pool; Finish retrieves the backend report. Back to setup → Last report
reopens that same live report.

The browser can require an Enable audio click after an autoplay rejection.
Room ambience starts off in the bench and has its own checkbox. Student voices
play after Call on / Next question. Sounds follow Vite's `BASE_URL`, including
deployments under a URL prefix.

## Session wiring

The product mounts the live hook beside its existing demo hooks and selects it
only for Teaching with a configured API URL. The essential wiring is:

```jsx
const liveMode = Boolean(API_URL) && config.mode === 'teaching';
const live = useLiveSession({ config: { ...config, voices }, enabled: liveMode,
  onTranscript: (text) => dispatch({ type: 'LIVE_SAY', text }),
  onAgentEvent: (event) => {
    const action = agentEventToAction(event);
    if (action) dispatch(action);
  },
});
const demoSpeech = useSpeechRecognition(respond);
const speech = liveMode ? live.speech : demoSpeech;
// Live text: live.submitText(text); skip STEP, fake replies, and speak().
// Slides: update the page locally, then send live.setSlide(index).
// Call on: live.callOn(questionId); then live.answerDone(questionId).
// Q&A: live.endTalk(), live.nextQuestion(), live.finishQA().
// Completion: onEnd({ kind: 'live', report: live.report, config }).
```

`LIVE_SAY` appends presenter text without changing student states, raised hands,
or question/verdict bubbles. The backend changes those states on later events.
App stores live reports in a `{ kind: 'live', report, config }` envelope and
renders `LiveReport` when Last report is opened. Demo reports keep their existing
format. Slides update locally before network acknowledgement; the current slide
is re-sent after a reconnect.

The default live classroom uses Alex, Maya, Ana, Sam and Priya, matching backend
L0–L4. Custom audiences, question frequency and seriousness are not supported
by this fixed preset.

## Boundaries and recovery

- PDF decks are fetched from the UI's blob URL and uploaded for text extraction.
  Image decks show an unsupported message. With no upload, only slide titles
  and bullet points are sent, never the demo's scripted presenter lines.
- The backend owns meters, grounding, answer verdicts, and delivery metrics.
  Live reports show that report instead of the demo engine's richer scores.
  The heatmap and top improvements are not in the backend's v0 report yet.
- Reconnect rebuilds hands/meters and advances sequence numbers from replay
  without replaying old voices or room sounds. Pending requests reject rather
  than being resent. A backend restart loses in-memory sessions; leave and
  start another session if the session is no longer available.
- Active audio owns mic muting and backend playback messages. Browser speech
  is the fallback on synthesis failure or a five-second missing-audio timeout.
  Turning voices off cancels audio while keeping question text visible.
- Calling on a hand within roughly 0.7 seconds of finishing a sentence can
  drop that last sentence: its delayed final may arrive during playback. This
  requires a backend change; allow the caption to commit before Call on.
- The bench opts into event and transcript-ack logs. The product keeps those
  diagnostics out of its render updates.
- Exit closes the session through Q&A/reporting. The backend has no HTTP cancel
  endpoint, so a severed socket during teardown cannot guarantee cancellation.
- The backend has no pause command; the live UI hides the demo's Pause control.
  Camera remains the local self-view, with no visual analysis.

## Checks

From `frontend`:

```sh
npm run test:live
npm run build
```

Tests cover transport correlation/replay, persona mapping, live reducer state,
Scribe sequence/duration and mute filtering, audio FIFO/fallback lifetime,
ambience throttles, and prefixed sound URLs. Microphone capture and audible
voice quality still require a browser check.
