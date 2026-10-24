### Front Row

A practice classroom full of AI students.

Upload your slides, start talking, and a room of AI listeners reacts in real time. A confused first-year, a skeptical professor, an ESL student, a distracted student, and a domain expert each listen differently. They lose focus when you ramble, raise their hands when something is unclear, and ask you questions at the end. When you finish, you get a slide-by-slide map of who you lost and where.

Built for Hackachusetts 2026, Civic Action track (Better college experiences).

Why

Most students rehearse presentations alone. Practicing in front of an audience leads to better real performances, but not everyone has a study group, confident English, or time for office hours. Front Row gives every student an audience to practice with, any time, with no judgment.

What makes it different
A whole room, not one coach. 5 to 12 listener agents with distinct personas, not a single AI judge.
Comprehension, not just delivery. Other tools count filler words. Front Row shows which kinds of listeners understood each slide.
Grounded questions. Every question an agent asks must quote something you actually said or showed.
A real classroom feel. A moderator decides who gets to interrupt, so the room behaves like a class instead of a chat flood.


How it works
Mic (browser STT) ──► transcript ──► Orchestrator ──► AI listeners (parallel)
Slides (PDF)      ──► slide text ──►      │                  │
                                          ▼                  ▼
                                      Moderator ◄──── reactions, raised hands
                                          │
                                          ▼
                       Live room UI  ·  Q&A  ·  Per-slide comprehension report
Every 15 seconds, the orchestrator sends the latest stretch of your talk to every listener at once.
Each listener returns its attention, confusion, what it understood, and optionally a question.
The moderator picks at most one interruption at a time and saves the rest for Q&A.
At the end, listeners ask their best questions, then the report shows a heatmap of comprehension by slide and persona, plus your top fixes.
Monorepo structure
frontrow/
├── README.md
├── spec.md                      # full technical spec
├── Makefile                     # dev, test, replay, eval shortcuts
├── .env.example                 # AI_API_KEY, FRONTROW_LLM=fake|LLM
│
├── apps/
│   ├── api/                     # Python backend (FastAPI + asyncio)
│   │   ├── pyproject.toml
│   │   ├── frontrow/
│   │   │   ├── config.py        # tick length, timeouts, model names, presets
│   │   │   ├── models.py        # Slide, TranscriptChunk, Persona, Reaction, HandRaise
│   │   │   ├── personas.py      # persona definitions and room presets
│   │   │   ├── llm/
│   │   │   │   ├── base.py      # LLMClient interface
│   │   │   │   ├── llm_client.py
│   │   │   │   └── fake.py      # deterministic offline LLM for tests and demo fallback
│   │   │   ├── prompts/         # reaction, follow-up, Q&A, report templates
│   │   │   ├── transcript.py    # time-windowed transcript buffer
│   │   │   ├── agent.py         # one AI listener: memory, react(), trait adjustments
│   │   │   ├── grounding.py     # rejects questions that don't quote the talk
│   │   │   ├── moderator.py     # who interrupts, rate limits, Q&A pool
│   │   │   ├── orchestrator.py  # tick loop, parallel fan-out, backpressure
│   │   │   ├── recorder.py      # timeline of everything that happened
│   │   │   ├── report.py        # heatmap, delivery stats, top fixes
│   │   │   ├── clock.py         # real clock and simulated clock
│   │   │   ├── slides.py        # PDF to per-slide text
│   │   │   ├── replay.py        # CLI: replay a scripted talk
│   │   │   ├── eval.py          # CLI: run scenarios against real models
│   │   │   └── server.py        # REST + WebSocket endpoints
│   │   └── tests/               # pytest, runs fully offline with the fake LLM
│   │
│   └── web/                     # React + Vite frontend
│       ├── package.json
│       └── src/
│           ├── pages/           # Setup, Present, QA, Report
│           ├── components/      # AvatarGrid, Meter, HandCard, Heatmap, SlideViewer
│           ├── hooks/           # useSpeechToText, useSessionSocket
│           └── mocks/           # mock socket that replays a scenario (build UI without backend)
│
├── packages/
│   └── protocol/                # shared WebSocket message schemas
│       ├── schema.json          # source of truth for client/server messages
│       └── ts/                  # generated TypeScript types for the web app
│
├── scenarios/                   # scripted talks used by tests, replay, and demo
│   ├── jargon_dump.json
│   ├── slide_reader.json
│   ├── fast_talker.json
│   ├── unsupported_claims.json
│   ├── clear_talk.json
│   ├── bad_then_good.json       # the demo
│   ├── long_static_slide.json
│   └── silence.json
│
└── eval_runs/                   # saved outputs from live model evals (gitignored)
Where to start
You're working on	Start in
Agent orchestration and moderator	apps/api/frontrow/orchestrator.py, moderator.py, tests/
Persona behavior and prompts	apps/api/frontrow/personas.py, prompts/, eval.py
Server and report	apps/api/frontrow/server.py, report.py
Frontend	apps/web/src/, using mocks/ until the server is ready
Message format between front and back	packages/protocol/schema.json
Frontend or speech (STT/TTS) integration	docs/backend-interface.md
Quick start
bash
# backend
cd apps/api
pip install -e ".[dev]"
cp ../../.env.example ../../.env        # add LLM_API_KEY, or use FRONTROW_LLM=fake
pytest                                  # offline tests
python -m frontrow.replay ../../scenarios/bad_then_good.json --llm fake --print-timeline
uvicorn frontrow.server:app --reload

# frontend
cd apps/web
npm install
npm run dev
Tech

Python, FastAPI, asyncio, Pydantic, LLM's for different reaction, React, Vite, browser speech recognition.

Team