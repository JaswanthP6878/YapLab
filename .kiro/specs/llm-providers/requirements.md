# Requirements Document

## Introduction

This document specifies how the FrontRow backend selects and talks to a real language model for listener reactions, answer judging, and talk summaries. The orchestration core only depends on the `LLMClient` interface; this spec covers the concrete providers behind it: any OpenAI-compatible chat completions API (DeepSeek and OpenAI), Anthropic's Claude, the deterministic Fake LLM, the fallback wrapper that keeps a session running when a provider fails, and how configuration and API keys are loaded from the repository's `.env` file.

DeepSeek is used through its OpenAI-compatible endpoint (`https://api.deepseek.com`), so it shares the OpenAI client with only a different base URL, API key variable, and default model.

## Glossary

- **System**: The FrontRow backend.
- **Provider**: The model service selected by `FRONTROW_LLM`: `fake`, `deepseek`, `openai`, or `anthropic`.
- **OpenAI_Compatible_Client**: The client for providers that implement the OpenAI chat completions API, configured per provider with a base URL, an API key variable, and a default model.
- **Anthropic_Client**: The client for Claude through the Anthropic Messages API.
- **Fake_LLM**: The deterministic offline client used for tests and as the fallback.
- **Fallback_Wrapper**: The client that forwards each request to a real Provider and answers from the Fake_LLM when the Provider fails.
- **Env_File**: The git-ignored `.env` file at the repository root, copied from `.env.example`.
- **Default_Model**: The model used when `FRONTROW_LLM_MODEL` is unset or blank.

## Requirements

### Requirement 1: Provider Selection

**User Story:** As a developer, I want to pick the model provider with one setting, so that I can switch between offline runs, DeepSeek, OpenAI, and Claude without code changes.

#### Acceptance Criteria

1. THE System SHALL select the Provider from the `FRONTROW_LLM` setting, defaulting to `fake` when it is unset or blank.
2. WHEN `FRONTROW_LLM` is `deepseek` or `openai`, THE System SHALL use the OpenAI_Compatible_Client configured for that Provider, wrapped in the Fallback_Wrapper.
3. WHEN `FRONTROW_LLM` is `anthropic`, THE System SHALL use the Anthropic_Client wrapped in the Fallback_Wrapper.
4. IF `FRONTROW_LLM` names an unknown Provider, THEN THE System SHALL fail at startup with an error listing the supported Providers.
5. WHEN the server starts with a real Provider, THE System SHALL construct the client once so that a missing API key or SDK fails at startup rather than during a session.

### Requirement 2: OpenAI-Compatible Providers

**User Story:** As a developer, I want DeepSeek to work through the same client as OpenAI, so that adding the provider needs no new integration code.

#### Acceptance Criteria

1. THE OpenAI_Compatible_Client SHALL read its base URL, API key variable, and Default_Model from a per-Provider table.
2. WHERE the Provider is `deepseek`, THE OpenAI_Compatible_Client SHALL send requests to `https://api.deepseek.com` using `DEEPSEEK_API_KEY`.
3. WHERE the Provider is `openai`, THE OpenAI_Compatible_Client SHALL use the SDK's default base URL and `OPENAI_API_KEY`.
4. THE OpenAI_Compatible_Client SHALL request JSON object output and cap each completion at 400 tokens.
5. IF the Provider's API key variable is not set, THEN THE OpenAI_Compatible_Client SHALL raise an error naming that variable.

### Requirement 3: Anthropic Provider

**User Story:** As a developer, I want Claude available as a provider, so that the team can demo with Claude models.

#### Acceptance Criteria

1. THE Anthropic_Client SHALL authenticate with `ANTHROPIC_API_KEY` and raise an error naming the variable when it is missing.
2. THE Anthropic_Client SHALL instruct the model to return exactly one JSON object and SHALL raise an error when the reply contains no JSON object.
3. THE Anthropic_Client SHALL disable SDK retries so that the Fallback_Wrapper alone owns the request deadline.
4. WHERE the model is `claude-haiku-5-5`, THE Anthropic_Client SHALL disable extended thinking so that short listener replies fit the token budget.

### Requirement 4: Default Models

**User Story:** As a developer, I want each provider to have a sensible default model, so that selecting a provider is enough to run.

#### Acceptance Criteria

1. WHILE `FRONTROW_LLM_MODEL` is unset or blank, THE System SHALL use `deepseek-flash` for `deepseek`, `claude-haiku-5-5` for `anthropic`, and `gpt-4o-mini` for `openai` and `fake`.
2. WHEN `FRONTROW_LLM_MODEL` is non-empty, THE System SHALL use that model for every request.
3. WHERE the replay command is given `--llm <provider>` without `--model` and `FRONTROW_LLM_MODEL` is not set, THE System SHALL use that Provider's Default_Model.

### Requirement 5: Fallback on Provider Failure

**User Story:** As a presenter, I want the room to keep reacting when the model service fails, so that a network problem does not freeze my practice session.

#### Acceptance Criteria

1. IF the Provider raises an error, returns output that is not a JSON object, or does not respond within the configured LLM timeout, THEN THE Fallback_Wrapper SHALL return the Fake_LLM's response for that request.
2. WHEN a request falls back, THE System SHALL record an `llm_fallback` event with a short reason on that session's timeline.
3. THE Fallback_Wrapper SHALL report fallbacks per session so that one session's failures are not attributed to another.

### Requirement 6: Latency Budget for Short Ticks

**User Story:** As a developer, I want shorter ticks to shorten the listener deadline automatically, so that demo settings stay valid without editing several values.

#### Acceptance Criteria

1. WHILE no per-listener timeout is configured, THE System SHALL use the smaller of 10 seconds and two thirds of the tick interval.
2. WHEN a per-listener timeout is configured explicitly, THE System SHALL require it to be strictly less than the tick interval.

### Requirement 7: Environment File

**User Story:** As a developer, I want API keys and settings read from one `.env` file, so that I do not export variables in every terminal and keys never reach git.

#### Acceptance Criteria

1. WHEN any backend entry point imports the package, THE System SHALL load the Env_File at the repository root if it exists.
2. WHILE a variable is already set in the process environment, THE System SHALL keep that value instead of the Env_File's value.
3. THE repository SHALL ignore `.env` and `.env.*` files in every directory, except `.env.example`.
4. THE offline verification runner SHALL force `FRONTROW_LLM=fake` so that its results do not depend on the Env_File.

### Requirement 8: Client Cleanup

**User Story:** As an operator, I want provider connections closed on shutdown, so that the server exits cleanly.

#### Acceptance Criteria

1. WHEN the server shuts down, THE System SHALL close each provider client's pooled HTTP resources.
2. WHEN several sessions or the startup check share one client, THE System SHALL close that client at most once.
