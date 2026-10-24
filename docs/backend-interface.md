# FrontRow backend interface

What the frontend and the speech (STT/TTS) work need to know to plug into the backend. The backend lives in `apps/api/frontrow/`; the machine-readable schema is `packages/protocol/schema.json` (regenerate with `uv run python -m frontrow.protocol > ../../packages/protocol/schema.json`).

## 1. The loop

```
 Browser                                   Backend (FastAPI)                     Providers
 ───────                                   ─────────────────                     ─────────
 POST /sessions (slides)       ──────────► create session (idle)
 POST /sessions/{id}/stt-token ──────────► STTTokenProvider.create_token ──────► ElevenLabs (mint token)
 ◄────────────── { token, ... }
 mic ═══ audio ════════════════════════════════════════════════════════════════► ElevenLabs STT
 ◄═══════════════════════════════════════════════════════ partial + final text ═
   partials: show as captions locally (never sent to backend)
   finals:   WS {type:"transcript", seq, text, duration} ──► Session.ingest_transcript
                                           tick loop every 15s: AI listeners react
 ◄── WS event tick_complete {room score}
 ◄── WS event hand_raised {question_id, persona, question, quote}
                                           TTSEngine.synthesize(question) ────────► ElevenLabs TTS
 ◄── WS event question_audio {url}
 GET /sessions/{id}/audio/{question_id} ─► audio bytes
```

The backend owns the clock, who speaks when, and every API key. The browser owns the mic, STT streaming, and audio playback.

## 2. Run it locally

```bash
cd apps/api
uv sync
uv run uvicorn frontrow.server:app --env-file ../../.env --reload   # http://127.0.0.1:8000
uv run python -m frontrow.fake_client --tick 5 --speed 2 --take-hands   # a scripted "browser"
uv run python verify.py                                 # offline checks
```

`fake_client.py` is a working reference for the whole message flow; read it alongside this doc.

Environment (see `.env.example`): `FRONTROW_LLM=fake|openai|anthropic`, the selected provider's API key, `FRONTROW_CORS_ORIGINS` (comma-separated, default `*`), plus the tunables in `frontrow/config.py`. Install `uv sync --extra anthropic` for Claude or `--extra openai` for OpenAI. If `FRONTROW_LLM_MODEL` is unset/blank, the defaults are `claude-haiku-5-5` for Anthropic and `gpt-4o-mini` for OpenAI. Shorter ticks use a shorter implicit listener timeout; explicitly configured timeouts must remain below the tick interval.

## 3. Session lifecycle

```
idle ──start──► presenting ──end_presenting──► qa ──end_qa──► reporting ──finish──► ended
```

| State | Listeners tick? | Accepts |
|---|---|---|
| `idle` | no | `slide`, `start` |
| `presenting` | yes, every tick interval (default 15s) | `transcript`, `slide`, `take_question`, `playback_*`, `answer_done`, `end_presenting` |
| `qa` | no | `transcript` (answers), `slide`, `next_question`, `playback_*`, `answer_done`, `end_qa` |
| `reporting` | no | `finish`; `GET /report` works |
| `ended` | no | nothing; `GET /report` works |

A message that isn't valid in the current state gets an `error` reply; the state is unchanged.

## 4. REST

| Method & path | Body | Returns |
|---|---|---|
| `GET /health` | | `{ok, sessions}` |
| `POST /sessions` | `{preset?, slides?: [{index, text}], tick_interval_seconds?}` | `201 SessionInfo` |
| `POST /sessions/upload` | multipart: `file` (PDF), `preset?`, `tick_interval_seconds?` | `201 SessionInfo` (slide text extracted per page); `400` empty/not a PDF/unreadable, `413` over 100 MB |
| `GET /sessions/{id}` | | `SessionInfo` |
| `GET /sessions/{id}/events?since=N` | | timeline events from index N (debugging, late join) |
| `POST /sessions/{id}/stt-token` | | `{token, provider, expires_in_seconds, ...provider extras}`; `501` if no provider configured, `502` if the provider failed, `409` if the session is over |
| `GET /sessions/{id}/audio/{question_id}` | | audio bytes (`Content-Type` from the engine); `404` if not synthesized |
| `GET /sessions/{id}/report` | | summary (see §9); `409` until the session reaches `reporting` |

`SessionInfo`: `{id, state, preset, current_slide, listeners: [{id, persona}], slides: [{index, text}]}`.

Presets: `default` (5 listeners), `full_room` (8), `lecture_hall` (10). Personas: `confused first-year`, `skeptical professor`, `ESL student`, `distracted student`, `domain expert`, `engaged student`. Listener ids are `L0`, `L1`, ...

## 5. WebSocket `/sessions/{id}/ws`

Text frames, one JSON object each. Connect with `?replay=1` to receive the whole timeline so far inside `hello` (for reconnects). Unknown session: you get one `error` message, then the socket closes with code `4404`.

### Client → server

Every message may carry an `id` (string or number); the reply `ack`/`error` echoes it.

| `type` | Fields | Effect / ack `result` |
|---|---|---|
| `start` | | idle → presenting |
| `transcript` | `seq` (int ≥ 0, increasing), `text`, `duration?` (seconds spoken) | ingest one **final** STT segment → `{accepted: bool}` (`false` for a repeated `seq`, empty text, or while question audio plays) |
| `slide` | `index` (0-based) | presenter moved to a slide |
| `take_question` | `question_id` | presenter calls on a raised (or pooled) hand → `{question_id}` |
| `playback_started` | `question_id` | question audio began; backend ignores mic text until `playback_ended` (or 30s) |
| `playback_ended` | `question_id` | question audio finished |
| `answer_done` | `question_id` | presenter finished answering; the asker judges it |
| `end_presenting` | | presenting → qa → `{qa_pool}` |
| `next_question` | | qa: close the current answer, ask the next → `{question_id, done}` (`done: true` when Q&A is over) |
| `end_qa` | | qa → reporting |
| `finish` | | reporting → ended |
| `ping` | | `{pong: true}` |

### Server → client

| `type` | Fields |
|---|---|
| `hello` | `session: SessionInfo`, `events: [...]` (backlog when `?replay=1`) |
| `ack` | `id`, `request` (the client `type`), `result` |
| `error` | `id`, `request`, `message`, `detail?` (validation errors). The socket stays open. |
| `event` | `event` (name), `t` (seconds on the session clock), `data` (below) |

## 6. Event catalog

"Hand fields" = `question_id, listener, persona, question, quote, source, follow_up_of` (+ `tick` when raised by a tick). `question` is the short sentence to **speak**; `quote` is the exact text from the talk/slide that prompted it, to **show**. `source` is `transcript`, `slide:N`, or `answer` (follow-ups). `question_id`s are unique per session but not contiguous.

| `event` | `data` | UI hint |
|---|---|---|
| `state` | `state` | switch screens |
| `slide_change` | `slide` | |
| `transcript` | `seq, start, end, text, answer_to` | `answer_to` = question id when it's an answer |
| `transcript_dropped` | `seq, text, reason: "agent_speaking"` | mic picked up question audio |
| `tick_start` | `tick, slide` | |
| `reaction` | `tick, listener, persona, slide, attention, confusion, understood, has_question` | per-avatar meters (0-100) |
| `tick_complete` | `tick, reactions, room: {attention, confusion, comprehension}` | room gauge; values `null` if nobody reacted |
| `hand_raised` | hand fields | show a raised hand; presenter may `take_question` |
| `hand_lowered` | hand fields | ignored for 45s (or talk ended) → moved to Q&A pool |
| `pooled` | hand fields | saved for Q&A (badge count) |
| `question_taken` | hand fields | presenter called on it; play its audio |
| `qa_question` | hand fields | Q&A: this listener asks now; play its audio |
| `question_audio` | `question_id, url, content_type` | audio ready at `url` (relative to the API base) |
| `question_audio_failed` | `question_id, error` | fall back to text (or browser speech) |
| `playback_start` / `playback_end` | `question_id` | echoes of the client messages |
| `answer` | `question_id, listener, text` | the full answer as heard |
| `answer_verdict` | `question_id, listener, persona, verdict, comment` | `verdict`: `answered` / `partial` / `dodged` |
| `answer_eval_error` | `question_id, listener, error` | |
| `grounding_rejected` | `tick, listener, question, quote` | debug: question didn't quote real content |
| `listener_timeout` / `listener_error` | `tick, listener` | debug |
| `skipped_tick` | | debug: previous tick overran |
| `llm_fallback` | `reason` | debug: real model failed, fake answered |
| `qa_pool` | `size` | |

## 7. Flows

**Presenting.** `POST /sessions` → open WS → `slide {index: 0}` → `start` → stream `transcript` finals with increasing `seq` → `slide` on every slide change → watch `tick_complete` / `reaction` for the live room.

**Mid-talk question.** `hand_raised` arrives (only one hand is up at a time; the next can't go up until 60s after the last question was asked). If the presenter calls on it: `take_question` → wait for `question_audio` (or use text) → `playback_started` → play → `playback_ended` → presenter answers (keep sending `transcript`; it's tagged as the answer) → `answer_done`. Expect `answer_verdict` within a second or two, and possibly a follow-up `hand_raised` with `follow_up_of` set. If the presenter ignores it, `hand_lowered` follows after 45s.

**Q&A.** `end_presenting` → loop: `next_question` → `qa_question` + `question_audio` → playback messages → answer via `transcript` → `next_question` again (it closes and judges the previous answer first, so a follow-up comes next). Stop when the ack says `done: true` → `end_qa` → `GET /report` → `finish`.

## 8. Rules for the frontend STT stream

1. **Send finals only.** Partials get revised; a listener could quote words that later disappear. Show partials as captions locally.
2. **`seq` increases per session** and is never reused. After a reconnect, resending a segment with the same `seq` is harmless (ignored).
3. **`duration`** is the segment's spoken length in seconds, if the STT provides word timings; otherwise omit it. Don't send absolute timestamps: the backend stamps each segment with its own clock on arrival.
4. **Pause STT (or mute the mic) while question audio plays**, and send `playback_started` / `playback_ended` around it. The backend also drops mic text in that window as a safety net, but echo cancellation alone won't stop STT from transcribing the agent's voice.
5. Fetch a fresh STT token on each (re)connect; tokens are short-lived.

## 9. Speech engines (backend side)

Defined in `apps/api/frontrow/speech.py`. Implement these and plug them in; nothing else in the backend changes.

```python
class TTSEngine(Protocol):
    async def synthesize(self, text: str, *, persona: str, listener_id: str) -> SpeechAudio: ...
    # SpeechAudio(data: bytes, content_type: str = "audio/mpeg")

class STTTokenProvider(Protocol):
    async def create_token(self, session_id: str) -> STTToken: ...
    # STTToken(token: str, provider: str, expires_in_seconds: float | None, extra: dict)
```

**Wiring.** Return your engines from `speech_engines_from_env()` in `frontrow/server.py` (e.g. pick by `FRONTROW_TTS=elevenlabs`), or pass them to `create_app(tts=..., stt_tokens=...)`. The defaults (`NoTTS`, `NoSTTTokens`) mean text-only questions and a `501` from the token endpoint.

**ElevenLabs.** Install `uv sync --extra elevenlabs`, set `ELEVENLABS_API_KEY`, and select `FRONTROW_TTS=elevenlabs` and/or `FRONTROW_STT=elevenlabs`. `FRONTROW_TTS_MODEL` defaults to `eleven_flash_v2_5`; conversational v4/v3 models use the dialogue WebSocket. Each engine reuses its HTTP client until app shutdown. `frontrow/voices.json` maps persona names to primary/alternate voices, selected by listener number modulo list length; inspect the account with `uv run python scripts/list_voices.py`. Scribe tokens expire after 900 seconds and expose `model_id=scribe_v2_realtime`, `vad_silence_threshold_secs=0.7`, and `include_timestamps=true` alongside the token. Unset/`none` retains the stand-ins; unknown engine values fail clearly.

**TTS expectations**
- Called once per question when it is raised (`hand_raised`) or asked in Q&A (`qa_question`); the result is cached per `question_id` and served at `/sessions/{id}/audio/{question_id}`.
- Pick the voice from `persona` (one distinct voice per persona); use `listener_id` to vary voices when a room has two of the same persona (`lecture_hall`).
- Questions are short (under ~25 words). Prefer a low-latency model; the `question_audio` event goes out as soon as `synthesize` returns.
- Raise on failure; the server emits `question_audio_failed` and the frontend falls back to text.
- Keep API keys server-side (environment), never in responses.

**STT token expectations**
- Mint a short-lived, single-use token for the browser's realtime STT connection (ElevenLabs has a single-use token API for realtime Scribe; confirm the exact endpoint in their docs).
- Put anything else the browser needs (model id, websocket URL, audio format) in `STTToken.extra`; it is passed through to the client verbatim.

## 10. Known limits

- Sessions live in memory in one process: restarting the server loses them, and there's no auth.
- `GET /report` is a v0 summary: room score per tick, question/answer verdict counts, and delivery stats (words, wpm, fillers, longest pause). The per-slide × persona heatmap and top fixes are still to come.
- With `FRONTROW_LLM=fake`, reactions and verdicts are deterministic placeholders, good for building UI, not for judging a talk. The demo uses `FRONTROW_LLM=anthropic` with `ANTHROPIC_API_KEY` (`uv sync --extra anthropic`); OpenAI remains supported with `FRONTROW_LLM=openai`, `OPENAI_API_KEY`, and `--extra openai`.
