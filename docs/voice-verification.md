> Team backend: `apps/api/frontrow/`. The notes below preserve the earlier donor walking-skeleton measurements; references to `backend/` and an undecided LLM provider are historical. The team demo now selects Claude through the optional Anthropic adapter. Current integration measurements are recorded separately at the end.

# Voice walking skeleton verification

Verified October 24, 2026. No LLM is involved. LLM provider selection remains open.

## Implemented

- Backend single-use Scribe token endpoint; the API key remains on the backend.
- Browser Scribe microphone capture with explicit VAD, verbatim fillers, live partials,
  and committed word timestamps rounded to room-relative integer milliseconds.
- A canned voiced question after every third accepted commit, round-robin through
  Maya, Dev, and Sam; TTS never blocks the WebSocket receive loop.
- One outbound writer per session, tracked background jobs, and cleanup on end,
  restart, and disconnect.
- FIFO student playback, playback start/end callbacks, speaking-card highlight,
  microphone retry, non-fatal server errors, and autoplay recovery.
- Echo guard requiring both active/recent playback and a fuzzy text match above 70.
- All eleven generated MP3 effects. Both 10-second room tones requested seamless
  looping; every saved asset was checked with ffprobe. A second generation run
  skipped all eleven files without calling the provider.

## Verified API choices and architecture corrections

The [React Scribe SDK](https://elevenlabs.io/docs/eleven-api/resources/libraries/scribe-stt/react-scribe)
defaults to manual commits, so the hook sets `CommitStrategy.VAD`. The
[realtime API](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime)
sends a delayed timestamped event in addition to the basic committed event. Only
the timestamped event is forwarded, preventing duplicates. `noVerbatim: false`
keeps disfluencies. The hook explicitly sets `vadSilenceThresholdSecs: 0.7`;
the real-provider echo timing check below exposed why the 1.5-second default does
not fit the requested one-second guard.

`eleven_flash_v2_5` uses the [TTS REST conversion API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
The expressive `eleven_v4_turbo` and `eleven_v3_conversational` models use the
[Text-to-Dialogue WebSocket](https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tdd).
That transport correction is implemented in `synthesize`, rather than sending
those model IDs to the Flash endpoint. The installed Python and React SDK signatures
were inspected alongside the official documentation.

## Account voice selection

These five distinct voices were returned by the authenticated, paginated voice
catalog. No cloned voice was created.

| Persona | Voice | Character |
|---|---|---|
| Maya | Jessica (`cgSgspJ2msm6clMCkdW9`) | Young, bright, warm American female |
| Dev | Charlie (`IKne3meq5aSn9XLyUdCD`) | Young, confident Australian male |
| Sam | Will (`bIHbv24MWmeRgasZH58o`) | Young, relaxed American male |
| Priya | Lily (`pFZP5JQG7iQjIQuC4Bku`) | British female, velvety actress |
| Leo | Liam (`TX3LPaxmHKxFdv7VOQHJ`) | Young, energetic American male |

These are the account's current Default voices. ElevenLabs documents their
[replacement schedule](https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-default-voices),
including expiry on December 31, 2026. Rerun the voice catalog before later demos.

## Real-provider A/B measurements

Same voice (Jessica) and same line for both models:

> [curious] Wait, can you explain that part again with a simple example?

Measurement is **complete MP3 generation**, including connection setup. It is not
first-byte latency or the whole microphone-to-speaker path. Three sequential
requests per model were made; no load test was run.

| Model | Samples (ms) | Median | Worst |
|---|---|---|---|
| `eleven_flash_v2_5` | 693, 420, 548 | 548 ms | 693 ms |
| `eleven_v4_turbo` | 894, 847, 864 | 864 ms | 894 ms |

Recommendation: retain Flash for this walking skeleton, based on its measured
lower generation latency. Production canned replies omit tags on Flash. The
comparison deliberately used identical tagged input; no subjective audio-quality
claim is made from these timings. `scripts/compare_tts.py` can rerun the comparison
and saves MP3 samples plus `results.json` under the system temporary directory.

## Real-provider automated speech/echo smoke

Synthetic presenter speech was streamed at real-time speed through a genuine
single-use-token Scribe connection, then forwarded to the running app session.
This was a diagnostic script outside the repository, not a product feature.

- Token endpoint: HTTP 200.
- Audio stream: 29.23 seconds total, including replayed student speech; presenter
  phase: 24.815 seconds.
- Four presenter commits, 24 partial events, and 69 valid integer word timings.
- Exact filler phrase observed in a committed transcript: `Um, uh, um...`.
- Maya reply: valid MP3, 44,764 bytes, decoded duration 2.74 seconds.
- Trigger commit → **simulated playback callback**: 484 ms (one observation, so
  median and worst are both 484 ms). This is not a hardware playback measurement.
- Actual student audio was streamed back through real Scribe while simulated
  playback remained active. The backend logged `echo_drop` for the resulting
  student self-transcription.

A stricter follow-up test sent `playback.ended` immediately after the actual paced
MP3 replay finished. With the provider's default 1.5-second VAD silence threshold,
the exact student echo arrived **1,365 ms after playback end**, outside the guard.
After explicitly setting 0.7-second VAD in the React hook, the real-provider retest
delivered the timestamped echo **749 ms after playback end**, inside the unchanged
one-second guard, and the backend logged `echo_drop`. Only the timestamped event
was forwarded. These callbacks track a real-time audio replay, but still simulate
the browser/hardware boundary; an acoustic no-headphone room check is separate.

The live browser separately reached listening/captions and played Maya, Dev, Sam,
and Maya again. Four real browser `playback.started` callbacks measured 368, 359,
322, and 353 ms: **median 356 ms, worst 368 ms**. These measure commit arrival at
the backend through the browser's actual audio `playing` event, excluding Scribe's
speech-recognition delay. The human headphone and no-headphone checks remain
distinct from the synthetic smoke.

## Automated checks

- Backend: `uv run pytest -q` — 93 tests passed.
- Frontend: `npm test` — 15 tests passed.
- Production frontend: `npm run build` — passed.
- Whitespace: `git diff --check` — passed.

Coverage includes integer time conversion, filler preservation, first-audio clock
anchoring, token/connect cancellation races, queue sequencing and autoplay recovery,
one WebSocket writer, nonblocking TTS, round-robin replies, echo windows, original
trigger latency, task cancellation, token/TTS failures, and script idempotence.

The frontend build currently reports a size warning for the ElevenLabs dependency
bundle; code splitting is deferred beyond this functional walking skeleton.

## Team backend integration — October 24, 2026

The integration lives in `apps/api/frontrow/` on `zukhriddin/voice-integration`.
It plugs into the existing speech and LLM interfaces; the team WebSocket schema,
moderator, session, and orchestration files are unchanged. The old voice checkout
was read as donor code only.

### Provider configuration

Install extras with `uv sync --extra elevenlabs --extra anthropic` in `apps/api/`.
Use the ignored repo-root `.env` with `FRONTROW_LLM=anthropic`,
`ANTHROPIC_API_KEY`, `FRONTROW_TTS=elevenlabs`, `FRONTROW_STT=elevenlabs`, and
`ELEVENLABS_API_KEY`. Start with `uv run uvicorn frontrow.server:app --env-file
../../.env`. Keep `FRONTROW_LLM_MODEL` blank for the provider default.

The default Claude model is `claude-haiku-5-5`, verified against the
[current model documentation](https://platform.claude.com/docs/en/models/haiku-5-5/overview).
OpenAI remains supported with its original default. The existing generic LLM
interface supplies no response schema, so the Claude adapter requests a JSON-only
object, validates it, and returns normalized JSON through the existing fallback
wrapper. Claude's thinking is disabled for these short responses to keep its
1024-token budget available for the answer. Speech engines reuse HTTP clients;
shutdown closes both speech and LLM clients after their producers/jobs stop.

### Persona voices

Every persona has a unique primary and at least two available voices. Selection
uses the numeric listener ID modulo the list length. First-year and engaged
lists have four and three entries respectively, so duplicate listeners differ
in both `full_room` and `lecture_hall`.

| Persona | Primary | Alternate(s) |
|---|---|---|
| confused first-year | Jessica | Sarah, Laura, Matilda |
| skeptical professor | Bill — older, wise/balanced | Daniel — formal British broadcaster |
| ESL student | Monika Sogam — natural Indian English | Anika — conversational Indian English |
| distracted student | Will | Charlie |
| domain expert | Lily | Daniel |
| engaged student | Liam | Charlie, Chris |

Professor IDs are Bill `pqHfZKP75CvOlQylNhV4` and Daniel `onwK4e9ZLuTAKqWW03F9`.
ESL IDs are Monika `2zRM7PkgwBPiau2jvVXc` and Anika `90ipbRoKi4CpHXvKVtl0`.
Bill/Daniel came from the account's saved catalog. The saved catalog's only
Indian-accent voice was a cartoon child, so the ESL choices came from the
account-authenticated professional voice library instead. Both synthesized a
short English test line successfully (38,913 and 37,659 bytes); no voice cloning
or account-library mutation was needed.

### Live fake-LLM + real speech check

Run with `FRONTROW_LLM=fake FRONTROW_TTS=elevenlabs FRONTROW_STT=elevenlabs
FRONTROW_TICK_INTERVAL_SECONDS=5`, then:

```sh
uv run python -m frontrow.fake_client --tick 5 --speed 2 --take-hands
```

The scripted talk completed presenting, Q&A, and report generation and emitted
six `question_audio` events. Logged TTS generation times were 410, 339, 357, 284,
311, and 347 ms: **median 343 ms, worst 410 ms**. Fetching its first audio URL
returned HTTP 200, `audio/mpeg`, **74,439 bytes**; ffprobe decoded it as MP3 with a
4.598-second duration. The first question's `generation_ms` was **410**.

A fresh idle session's `POST /sessions/{id}/stt-token` returned HTTP 200 with a
nonempty token, provider `elevenlabs`, expiry 900 seconds, and the required
`model_id=scribe_v2_realtime`, `vad_silence_threshold_secs=0.7`, and
`include_timestamps=true`. Tokens and keys were not written to this report.

### Live Claude check

The same scripted client with Claude produced **25 real reactions over five
ticks**, **zero `llm_fallback` events**, zero listener errors/timeouts, and 13
`question_audio` events with zero audio failures. Tick completion times were
1,341, 1,407, 1,754, 1,886, and 2,349 ms (all five listeners in parallel).

Example confused first-year reaction:

> Got that nodes talk over a network, but not sure why unreliable is the big problem.

Its adjusted attention was 67 and confusion 78. Its grounded spoken question was:

> Sorry, what does it mean that the network is unreliable, and why does that make things hard?

### Offline checks and small compatibility fixes

`uv run python verify.py`: **41 passed, zero failed**, including all 28 original
checks. Provider checks use in-memory SDK stand-ins and require no network or
provider credentials. They cover factories, optional dependencies, JSON-only
Claude responses/fallbacks, voice-map coverage and duplicate listeners, client
reuse, token settings, sanitized errors, dependency injection, and shutdown.

The requested five-second tick previously conflicted with the implicit ten-second
listener timeout. Only the implicit configuration default now follows shorter
ticks; explicit invalid timeouts still fail validation. Explicitly injected
speech engines no longer instantiate unused environment providers. Shutdown waits
for in-flight session work before cancelling voice jobs, then closes shared
clients once. These changes preserve the existing protocol and orchestration.
