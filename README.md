# Front Row

A practice classroom full of AI students.

Upload your slides, start talking, and a room of AI listeners reacts in real time. A confused first-year, a skeptical professor, an ESL student, a distracted student, and a domain expert each listen differently. They lose focus when you ramble, raise their hands when something is unclear, and ask you questions out loud at the end. When you finish, you get a slide-by-slide map of who you lost and where.

Built for Hackachusetts 2026, Civic Action track (Better college experiences).

## Why

Most students rehearse presentations alone. Practicing in front of an audience leads to better real performances, but not everyone has a study group, confident English, or time for office hours. Front Row gives every student an audience to practice with, any time, with no judgment.

## What makes it different

- **A whole room, not one coach.** 5 to 12 listener agents with distinct personas, not a single AI judge.
- **Comprehension, not just delivery.** Other tools count filler words. Front Row shows which kinds of listeners understood each slide.
- **Grounded questions.** Every question an agent asks must quote something you actually said or showed.
- **A real classroom feel.** A moderator decides who gets to interrupt, so the room behaves like a class instead of a chat flood.
- **Practice answering, too.** Listeners ask their questions aloud and judge whether your answer actually addressed them.

## How it works

```
Mic ──► ElevenLabs STT (in the browser) ──► final transcript ──┐
Slides (PDF) ──► per-slide text ───────────────────────────────┤  WebSocket
                                                               ▼
                         Orchestrator ──► AI listeners (in parallel, every 15s)
                              │                    │
                              ▼                    ▼
                          Moderator ◄──── reactions, raised hands
                              │
                              ▼
          Live room UI  ·  questions spoken via TTS  ·  Q&A  ·  report
```

1. The browser streams your voice to ElevenLabs speech-to-text using a short-lived token from the backend, and forwards each final transcript segment over the session WebSocket.
2. Every 15 seconds, the orchestrator sends the latest stretch of your talk, plus the slides shown so far, to every listener at once.
3. Each listener returns its attention, confusion, what it understood, and optionally a question that quotes your talk or slides. Listeners remember how they felt over the last few stretches (so attention drifts instead of resetting), the questions they already raised and how those were answered (so they don't repeat themselves), and rolling notes on the whole talk so far (so they can connect what you say now to what you said minutes ago).
4. The moderator lets one hand up at a time, preferring listeners who haven't spoken yet and are the most confused. Everything else is saved for Q&A.
5. When you call on a hand, its question is spoken through text-to-speech; your answer is transcribed and the listener judges it as answered, partial, or dodged, and may ask one follow-up.
6. At the end, listeners ask their best saved questions, then the report summarizes how the room followed you.

## Status

| Part | State |
|---|---|
| Orchestration: tick loop, listeners, grounding, moderator, Q&A, answer judging | Done, verified offline |
| Server: REST + WebSocket, PDF slides, TTS/STT engine hooks | Done |
| Report | v0: room score per tick, answer verdicts, delivery stats. Slide × persona heatmap and top fixes still to come |
| Speech: ElevenLabs STT token + TTS engines | Integrated through optional provider extra |
| Frontend (`apps/web`) | In progress |

## Repository layout

```
front_row/
├── README.md
├── .env.example                  # FRONTROW_LLM, OPENAI_API_KEY, ELEVENLABS_API_KEY, tunables
├── docs/
│   └── backend-interface.md      # REST/WebSocket protocol and speech engine interfaces
├── packages/
│   └── protocol/
│       └── schema.json           # JSON schema for client/server messages (generated)
├── scenarios/
│   └── sample_talk.json          # scripted talk used by verify, replay, and the fake client
└── apps/
    ├── api/                      # Python backend (FastAPI + asyncio)
    │   ├── pyproject.toml        # managed with uv
    │   ├── verify.py             # offline checks (fake LLM + simulated clock)
    │   ├── demo.py               # shortcut for python -m frontrow.replay
    │   └── frontrow/
    │       ├── server.py         # REST + WebSocket endpoints
    │       ├── protocol.py       # typed wire messages; exports schema.json
    │       ├── session.py        # session lifecycle, transcript ingest, Q&A
    │       ├── orchestrator.py   # tick loop, parallel fan-out, timeouts, backpressure
    │       ├── moderator.py      # hand-raise lifecycle, ranking, rate limit, Q&A pool
    │       ├── agent.py          # one AI listener: memory, react(), evaluate_answer()
    │       ├── personas.py       # persona definitions and room presets
    │       ├── prompts.py        # reaction and answer-judging prompts
    │       ├── grounding.py      # rejects questions that don't quote the talk or slides
    │       ├── metrics.py        # room score, words per minute, fillers, pauses
    │       ├── transcript.py     # time-windowed transcript buffer
    │       ├── slides.py         # PDF to per-slide text
    │       ├── speech.py         # TTSEngine / STTTokenProvider interfaces
    │       ├── clock.py          # real and simulated clocks
    │       ├── config.py         # tick length, timeouts, model, moderator settings
    │       ├── models.py         # Slide, TranscriptChunk, Persona, Reaction, HandRaise, ...
    │       ├── replay.py         # CLI: run a scripted talk offline, print the room score
    │       ├── fake_client.py    # CLI: a scripted browser against a running server
    │       └── llm/
    │           ├── base.py       # LLMClient interface
    │           ├── fake.py       # deterministic offline LLM for tests and fallback
    │           ├── fallback.py   # falls back to the fake LLM when the real one fails
    │           └── openai_client.py  # OpenAI-compatible client (DeepSeek, OpenAI)
    └── web/                      # React + Vite frontend (in progress)
```

## Where to start

| You're working on | Start in |
|---|---|
| Agent orchestration and moderator | `apps/api/frontrow/orchestrator.py`, `moderator.py`, `session.py`, `verify.py` |
| Persona behavior and prompts | `apps/api/frontrow/personas.py`, `prompts.py` |
| Server and report | `apps/api/frontrow/server.py` |
| Frontend | `docs/backend-interface.md`, then run `frontrow.fake_client` to watch the live event stream |
| Speech (STT/TTS) | `docs/backend-interface.md` §9, `apps/api/frontrow/speech.py` |
| Message format between front and back | `packages/protocol/schema.json` (generated from `protocol.py`) |

## Quick start

The backend uses [uv](https://docs.astral.sh/uv/).

```bash
cd apps/api
uv sync
cp -n ../../.env.example ../../.env   # loaded automatically; FRONTROW_LLM=fake runs fully offline

uv run python verify.py               # offline checks
uv run python demo.py                 # replay the sample talk, print the room score per tick
uv run uvicorn frontrow.server:app --env-file ../../.env --reload  # API at :8000

# in a second terminal: a scripted "browser" against the running server
uv run python -m frontrow.fake_client --tick 5 --speed 2 --take-hands
```

To use a real model, set `FRONTROW_LLM` and the matching key in `.env`, and install that provider's SDK:

| `FRONTROW_LLM` | Key | Install | Default model |
|---|---|---|---|
| `deepseek` | `DEEPSEEK_API_KEY` | `uv sync --extra openai` (OpenAI-compatible API) | `deepseek-flash` (or `deepseek-v4-pro`) |
| `anthropic` | `ANTHROPIC_API_KEY` | `uv sync --extra anthropic` | `claude-haiku-5-5` |
| `openai` | `OPENAI_API_KEY` | `uv sync --extra openai` | `gpt-4o-mini` |

Leave `FRONTROW_LLM_MODEL` blank for the provider default. Settings are read from the repo-root `.env` (git-ignored) on startup; variables already set in your shell take precedence. Extras combine, e.g. `uv sync --extra openai --extra anthropic --extra elevenlabs`.

For voice, also install `--extra elevenlabs` and set `FRONTROW_TTS=elevenlabs`,
`FRONTROW_STT=elevenlabs`, and `ELEVENLABS_API_KEY`. `FRONTROW_TTS_MODEL` defaults
to `eleven_flash_v2_5`. The backend reuses pooled HTTP clients and closes them on
shutdown; only single-use Scribe tokens reach the browser. Inspect voices with
`uv run python scripts/list_voices.py` from `apps/api/`.

After changing `frontrow/protocol.py`, regenerate the schema:

```bash
uv run python -m frontrow.protocol > ../../packages/protocol/schema.json
```

## Tech

Python, FastAPI, asyncio, Pydantic, DeepSeek V4 or Claude for listener reactions (OpenAI also supported), ElevenLabs for speech-to-text and text-to-speech, React, Vite.

## Team
