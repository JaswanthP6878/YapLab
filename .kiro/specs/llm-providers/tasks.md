# Implementation Plan

- [x] 1. Fallback wrapper
  - `FallbackLLM` with timeout, error, and non-JSON fallback to `FakeLLM`; `on_fallback` hook and `fallback_count`
  - Per-session hook that records `llm_fallback`
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 2. OpenAI-compatible provider table
  - [x] 2.1 `Provider` table with base URL, key variable, and default model for `openai` and `deepseek`
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [x] 2.2 JSON mode and a 400-token cap on every completion
    - _Requirements: 2.4_

- [x] 3. Anthropic provider
  - `AnthropicClient` with JSON-only instructions, no SDK retries, thinking disabled for Haiku 5.5
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Provider selection
  - `llm_from_env()` and `replay.make_llm()` accept `fake`, `deepseek`, `openai`, `anthropic`; unknown values fail with the list of options
  - Construct the client once at server startup
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 5. Default models
  - `_default_model()` per Provider; blank `FRONTROW_LLM_MODEL` means default; replay `--llm` picks the Provider default
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 6. Tick-scaled listener timeout
  - Implicit per-listener timeout of min(10 s, 2/3 of the tick); explicit values still validated against the tick
  - _Requirements: 6.1, 6.2_

- [x] 7. Environment file
  - [x] 7.1 Load the repo-root `.env` on package import with `override=False`; add `python-dotenv`
    - _Requirements: 7.1, 7.2_
  - [x] 7.2 Ignore `.env` and `.env.*` everywhere except `.env.example`; document every Provider in `.env.example`
    - _Requirements: 7.3_
  - [x] 7.3 Force the fake Provider in `verify.py`
    - _Requirements: 7.4_

- [x] 8. Client cleanup
  - `aclose()` on provider clients; `FallbackLLM.aclose()` closes each wrapped client once; server lifespan closes clients after sessions
  - _Requirements: 8.1, 8.2_

- [x] 9. Documentation
  - README provider table (key, install extra, default model) and `docs/backend-interface.md` environment section
  - _Requirements: 1.1, 4.1, 7.1_
