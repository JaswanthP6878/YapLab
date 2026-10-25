# NVIDIA Nemotron on Nebius Token Factory

YapLab's Nebius mode routes listener reactions and rolling summaries to **Nemotron 3 Nano**, and answer verdicts with optional follow-ups to **Nemotron 3 Ultra**. The models are served through Token Factory's OpenAI-compatible inference API. Voice remains ElevenLabs; the local teaching-move classifier remains a separate TalkMoves-derived model.

This integration was probed locally on **2026-10-25**. The hosted VM is switched manually after merge; these measurements do not claim it has already been migrated. The existing room cadence, hands, moderator, voice, and report behavior are retained.

## Model routing and request settings

| Role | Exact API model | Reasoning | Output cap |
|---|---|---|---:|
| Five listener reactions in parallel per tick | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Off | 400 tokens |
| Rolling talk summary after a completed tick, when new transcript exists | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Off | 400 tokens |
| Answer verdict and optional follow-up, one request per answer | `nvidia/Nemotron-3-Ultra-550b-a55b` | On | 4,096 tokens |

The default tick interval is **15 seconds**, with a **10-second listener deadline**. The summarizer runs after the room score is published and only when new transcript exists; subsequent listeners use its result. Answer evaluation runs off the tick path with its separate LLM timeout; reasoning has a larger budget because it shares completion tokens with the final JSON.

The Nebius request body uses `response_format={"type":"json_object"}` and the verified wire field `chat_template_kwargs.enable_thinking` (`false` for the fast tier, `true` for reasoning). Through the OpenAI SDK, the latter is sent in `extra_body`. Merely accepting JSON mode did not prevent truncation with reasoning enabled at 400 tokens. The provider consumes the final content, guards against inline `<think>…</think>` before JSON parsing, and does not use private reasoning text as a listener response.

Nano was selected because all **30/30** five-way load responses matched the listener schema. Lightning was faster in the same small probe but only **29/30** matched the schema. Ultra matched the answer schema in **5/5** actual grading-prompt probes with reasoning enabled; Super also passed **3/3**. We chose Ultra for off-tick answer reasoning, consistent with the track's guidance, not because these small format probes establish superior grading quality.

## Authenticated catalog and compatibility probes

The authenticated catalog was captured at **2026-10-25T19:02:09Z**. Exact ID capitalization matters. [Sanitized evidence](evidence/nebius-probes.json) retains catalog pricing, timestamps, token usage, validation results, and all 78 requests; it omits keys, headers, prompts, and output text.

List prices below are USD **per 1,000,000 tokens**, converted from the API's **per-token** strings. A null cache price is not a free-token offer.

| Exact API model | Input / 1M | Cached input / 1M | Output / 1M |
|---|---:|---:|---:|
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | $0.06 | Not published | $0.24 |
| `nvidia/Nemotron-3_5-Lightning` | $0.06 | Not published | $0.24 |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | $1.00 | $0.12 | $3.00 |
| `nvidia/nemotron-3-super-120b-a12b` | $0.30 | $0.06 | $0.90 |
| `nvidia/Nemotron-3.5-Super-VL` | $0.30 | $0.06 | $0.90 |

Every initial request used the same real listener prompt built from `scenarios/sample_talk.json`, JSON mode, and a 400-token cap. All five models accepted JSON mode with HTTP 200. At default thinking, every response hit `length` and failed complete JSON/schema validation; with thinking explicitly off, all five stopped normally with valid listener JSON.

| Model | Default thinking: latency; finish; JSON | Explicit thinking off: latency; finish; JSON |
|---|---|---|
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 1.423 s; `length`; invalid | 0.410 s; `stop`; valid |
| `nvidia/Nemotron-3_5-Lightning` | 1.561 s; `length`; invalid | 0.481 s; `stop`; valid |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 1.366 s; `length`; invalid | 0.667 s; `stop`; valid |
| `nvidia/nemotron-3-super-120b-a12b` | 3.135 s; `length`; invalid | 1.070 s; `stop`; valid |
| `nvidia/Nemotron-3.5-Super-VL` | 1.343 s; `length`; invalid | 0.708 s; `stop`; valid |

Each cell above is **one request**, not a latency percentile. Default-thinking responses reported reasoning in a separate field; no inline think tags were observed in these probes. Nano did not provide detailed reasoning-token accounting, so missing breakdowns are not evidence that reasoning used zero tokens.

## Five-way fast-tier load check

Each model ran **six batches of five concurrent listener requests**. This table uses only the 30 requests from those batches; it excludes the initial serial compatibility requests. Percentiles use linear interpolation at `(n − 1) × q` over all 30 completed request latencies, including Lightning's schema-invalid response.

| Model | Requests | Valid JSON | Listener schema | p50 | p95 | Maximum |
|---|---:|---:|---:|---:|---:|---:|
| `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | 30 | 30/30 | 30/30 | 0.786 s | 1.015 s | 1.020 s |
| `nvidia/Nemotron-3_5-Lightning` | 30 | 30/30 | 29/30 | 0.633 s | 0.841 s | 0.873 s |

Nano's measured p95 is below the default 10-second listener deadline for this prompt set and concurrency. Thirty samples do not establish a production reliability guarantee; longer live context and service load can change latency.

## Answer-reasoning probes

These use actual answer-grading prompts, explicit thinking on, and a **4,096-token cap**. All returned `answered` for the supplied answered fixtures, with valid answer JSON; this checks format and the exercised case, not independent pedagogical accuracy.

| Model | Valid answer schema | Latency range | Reported reasoning-token range |
|---|---:|---:|---:|
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 5/5 | 0.899–1.717 s | 58–381 |
| `nvidia/nemotron-3-super-120b-a12b` | 3/3 | 1.046–1.506 s | 130–183 |

## Replay and three-minute live measurements

### Sample replay: measured

The supplied sample talk spans **40 seconds of simulated scenario time**, with the unchanged **15-second tick** and **45-second / 60-word warm-up**. Model request latencies below use wall time. This run made **15 reaction calls and 3 summary calls**, all on the fast tier; there were no hands or answer-evaluation calls because the sample ends before the warm-up time. **The replay does not exercise the grader.**

| Tier | Calls | p50 | p95 | Input tokens | Cached input | Output tokens | Fallbacks | Estimated USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Fast (Nano) | 18 | 0.684 s | 1.070 s | 8,101 | 0 | 1,207 | 0 | $0.00077574 |
| Reasoning (Ultra) | 0 | — | — | 0 | 0 | 0 | 0 | $0.00000000 |

Total returned usage was **8,101 input / 1,207 output tokens**, with **0 fallbacks**, **0 missing-usage calls**, and a Nebius list-price estimate of **$0.00077574**. A dash means the tier was not exercised, not zero-latency inference. The [replay statistics and scenario hash](evidence/nebius-replay.json) preserve the measured values. Percentiles use the same linear interpolation method as the load probes, on the per-tier recorded request latencies (all calls succeeded in this replay); no serial compatibility probes are included.

### Three-minute live session: measured

A local, real-time Teaching session sent **18 typed lecture lines over a 180-second target** and completed its report **185.886 seconds after start**, including the closing tick and Q&A. The default cadence remained **15 seconds**. It produced **3 transcript-grounded hands**, an Ultra **`answered`** verdict, and a final report with teaching-move feedback. The first hand appeared **46.83 seconds after presenting began**. The final hand arrived at **183.78 seconds**, during the closing tick after the 180-second lecture target; the completed-report duration includes that settling work and Q&A. An actual **76,947-byte ElevenLabs MP3** was fetched, and a Scribe v2 realtime token was minted. This typed smoke does **not** establish microphone-audio transcription.

| Tier | Calls | p50 | p95 | Input tokens | Recorded cached input | Output tokens | Fallbacks | Estimated USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Fast (Nano) | 72 | 1.647 s | 3.679 s | 42,477 | 0 | 5,385 | 0 | $0.00384102 |
| Reasoning (Ultra) | 1 | 1.000 s (n=1) | 1.000 s (n=1) | 360 | 0 | 161 | 0 | $0.00084300 |

The reasoning tier has **one observation**, so both displayed percentiles are that same **1.000-second** call, not a latency-distribution estimate. Its **121 reasoning tokens are included within the 161 output tokens**, not added again. The fast tier made **60 reaction calls and 12 summary calls**. Cached input is the reported subset when available; no cached discount was applied in either measured run.

The live run totaled **73 calls**, **42,837 input tokens**, and **5,546 output tokens**, with **0 fallbacks, errors, cancellations, missing-usage calls, or unpriced calls**. At the captured list prices, its estimated Nebius inference cost was **$0.00468402**, about **0.47 U.S. cents**. This is the measured local session, not a ten-minute extrapolation or a hosted-deployment claim; voice and hosting costs are excluded.

Evidence: [usage and cost](evidence/nebius-live-stats.json), [smoke outcomes and timing](evidence/nebius-live-proof.json), and [redacted model/TTS/session-end log excerpt](evidence/nebius-live-log-excerpt.txt). The log includes both exact model IDs and per-tier zero fallback counts. The [actual local Nemotron session report](evidence/nebius-live-report.png) was rendered with 44 analyzed presenter sentences and no browser console errors; the JSON files remain the primary numerical evidence. These outcomes exercise the integration, not an independent assessment of grading accuracy.

Cost is an estimate from Token Factory list prices and returned usage, not an invoice. Prompt-token counts include any cached subset. Apply the published cache-read rate when one exists and the cache count is known; otherwise, models with no published cached-input price charge all prompt tokens at their ordinary input rate, as stated in [Nebius cache-pricing documentation](https://docs.tokenfactory.nebius.com/cached-tokens) ([dated source receipt](evidence/nebius-cache-pricing-source.txt)). Completion tokens already include reasoning tokens and are not counted twice.

For a model with a published cache discount, missing cache-usage details leave the estimate incomplete. Missing input/output usage or an unknown model price also makes `cost_usd` unavailable; `known_cost_usd` covers only the priced subset. Timed-out calls without usage may still incur charges. ElevenLabs, VM, and other service costs are excluded. No unknown usage is represented as a free call.

Fallbacks are counted by tier and logged with provider, model, tier, and reason. A FakeLLM answer is a fallback, not a successful Nebius request. The zero counts above apply to these recorded runs, not as a guarantee that providers cannot fail.

## Run locally

```bash
cd apps/api
uv sync --extra openai --extra elevenlabs --extra data
cp -n ../../.env.example ../../.env
# Edit the ignored .env: FRONTROW_LLM=nebius and NEBIUS_API_KEY=<your key>.
# Leave model overrides blank for the role defaults listed above.
uv run uvicorn frontrow.server:app --reload
```

For the offline checks, use `FRONTROW_LLM=fake uv run python verify.py`. The fake, DeepSeek, OpenAI, and Anthropic providers remain supported. The Nebius provider uses the `openai` optional SDK extra; API keys remain on the server.

Replay the sample talk and write usage/latency/cost statistics (this makes real provider calls):

```bash
uv run --extra openai python demo.py --llm nebius --stats-out /tmp/nebius-replay.json
```

`demo.py` and `python -m frontrow.replay` accept `--model-fast`, `--model-reasoning`, and the shared `--model`. Each explicit role flag overrides its role environment variable. Otherwise, nonblank `FRONTROW_LLM_MODEL_FAST` / `FRONTROW_LLM_MODEL_REASONING` take precedence for that role. A shared `--model` or `FRONTROW_LLM_MODEL` supplies both roles only where no role-specific override exists; without overrides, Nebius uses Nano/Ultra and other providers retain their single model default. Blank environment entries follow defaults. The CLI prints both resolved model IDs and cadence before its results.

The repo-root `.env` is loaded before these entry points, and shell environment variables win over that file. Clear stale model overrides when switching providers.

The current verification run passed **72 offline backend checks**, **75 frontend live tests**, and the production build.

## Deploy after merge

Jaswanth sets `FRONTROW_LLM=nebius` and `NEBIUS_API_KEY` in the VM's ignored repo-root `.env`, preserving speech settings, then runs `infra/gcp/deploy.sh`. The deployment extras must include **openai**, **elevenlabs**, and **data**. Confirm the live app reaches the selected Nano/Ultra IDs and inspect per-tier fallback counts before treating the hosted demo as migrated. Do not put keys into tracked deployment examples or logs.

## Hackathon and license

The [official Best Apps and Agents description](https://nebiusglobalaihackathon.devpost.com/) recommends heavier reasoning with Ultra and responsive ordinary work with Nano or Super. The [rules](https://nebiusglobalaihackathon.devpost.com/rules) require substantive runtime use of the platform and an NVIDIA open model, plus a public licensed repository, setup instructions, demo, and public YouTube video. Submission closes **2026-10-30 at 10:00 PDT / 13:00 EDT**; judging access must remain free through **2026-12-15 at 12:00 PST / 15:00 EST**. Dates were checked on 2026-10-25.

YapLab's original code is [MIT licensed](../LICENSE). The TalkMoves-derived files in `apps/api/frontrow/models/` and `data/results/` are excluded from MIT and remain **CC BY-NC-SA 4.0**; their full licenses remain [with the model](../apps/api/frontrow/models/LICENSE.txt) and [with the analysis results](../data/results/LICENSE.txt). Dataset attribution and limitations are in the [datasheet](../data/README.md) and [methods/ethics document](data-science.md). The source corpus has 567 transcripts, while the benchmark uses **566 eligible lessons**.
