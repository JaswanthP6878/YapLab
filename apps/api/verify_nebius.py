"""Offline Nebius provider, role-routing, and session telemetry checks."""

from __future__ import annotations

import asyncio
import io
import json
import logging
import math
import os
import sys
from contextlib import contextmanager
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from frontrow.config import Config
from frontrow.llm.base import current_llm_call, emit_llm_event, llm_call_context
from frontrow.llm.fake import FakeLLM
from frontrow.llm.fallback import FallbackLLM
from frontrow.llm.openai_client import PROVIDERS, OpenAIClient
from frontrow.llm.usage import LLMUsage

FAST = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
REASONING = "nvidia/Nemotron-3-Ultra-550b-a55b"


@contextmanager
def _sdk():
    state = SimpleNamespace(clients=[], calls=[], text='{"ok":true}', usage={
        "prompt_tokens": 100, "completion_tokens": 40,
        "prompt_tokens_details": {"cached_tokens": 0},
        "completion_tokens_details": {"reasoning_tokens": 0},
    }, exception=None, block=False, started=None)

    class Usage:
        def model_dump(self, **kwargs):
            return state.usage

    class Client:
        def __init__(self, **kwargs):
            self.options = kwargs
            self.close_count = 0
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))
            state.clients.append(self)

        async def create(self, **kwargs):
            state.calls.append(kwargs)
            if state.started is not None:
                state.started.set()
            if state.block:
                await asyncio.Future()
            if state.exception is not None:
                raise state.exception
            return SimpleNamespace(usage=Usage() if state.usage is not None else None,
                choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(
                    content=state.text, reasoning_content='private reasoning {"wrong":true}'))])

        async def close(self):
            self.close_count += 1

    module = ModuleType("openai")
    module.AsyncOpenAI = Client
    with patch.dict(sys.modules, {"openai": module}):
        yield state


@contextmanager
def _quiet_llm_logs():
    logger = logging.getLogger("frontrow.llm")
    stream = io.StringIO()
    with patch.object(logger, "handlers", [logging.StreamHandler(stream)]):
        yield stream


def check_nebius_provider_options_and_legacy_requests() -> None:
    provider = PROVIDERS["nebius"]
    assert provider.base_url == "https://api.tokenfactory.nebius.com/v1/"
    assert provider.api_key_env == "NEBIUS_API_KEY"
    assert provider.default_model == FAST and provider.default_reasoning_model == REASONING

    async def run(state):
        events = []
        client = OpenAIClient(api_key="offline-key", provider="nebius")
        assert state.clients[-1].options["max_retries"] == 0
        for tier, thinking, cap in (("fast", False, 400), ("reasoning", True, 4096)):
            with llm_call_context(tier, "answer" if thinking else "reaction", events.append):
                assert await client.complete_json("system", "user", model="same-explicit-model", timeout=3.5) == {"ok": True}
            request = state.calls[-1]
            assert request["model"] == "same-explicit-model" and request["timeout"] == 3.5
            assert request["max_tokens"] == cap
            assert request["extra_body"] == {"chat_template_kwargs": {"enable_thinking": thinking}}
            assert request["response_format"] == {"type": "json_object"}
            assert request["messages"] == [{"role": "system", "content": "system"}, {"role": "user", "content": "user"}]
        assert [event["tier"] for event in events] == ["fast", "reasoning"]
        for event in events:
            assert event["kind"] == "request" and event["provider"] == "nebius"
            assert event["outcome"] == "success" and event["finish_reason"] == "stop"
            assert event["usage"] == state.usage and event["latency_seconds"] >= 0
        await client.aclose()
        await client.aclose()
        assert state.clients[0].close_count == 1

        for name in ("openai", "deepseek"):
            legacy = OpenAIClient(api_key="offline-key", provider=name)
            assert "max_retries" not in state.clients[-1].options
            with llm_call_context("reasoning", "answer"):
                await legacy.complete("system", "user", model="existing-model", timeout=2)
            assert state.calls[-1] == {
                "model": "existing-model", "messages": [{"role": "system", "content": "system"}, {"role": "user", "content": "user"}],
                "response_format": {"type": "json_object"}, "max_tokens": 400, "timeout": 2,
            }, state.calls[-1]
            await legacy.aclose()

    with _sdk() as state, _quiet_llm_logs():
        asyncio.run(run(state))


def check_nebius_thinking_text_cannot_shadow_json() -> None:
    async def run(state):
        client = OpenAIClient(api_key="offline-key", provider="nebius")
        for text in ('<think>{"wrong":true}</think>{"right":true}',
                     '<THINK>reasoning {"wrong":true}</THINK>\n{"right":true}',
                     'private trace {"wrong":true}</think>{"right":true}'):
            state.text = text
            assert await client.complete_json("s", "u", model=FAST, timeout=1) == {"right": True}
        for text in (None, '<think>unfinished private trace {"wrong":true}'):
            state.text = text
            assert await client.complete("s", "u", model=FAST, timeout=1) == ""
        legacy = OpenAIClient(api_key="offline-key", provider="deepseek")
        state.text = '<think>{"unchanged":true}</think>{"result":true}'
        assert await legacy.complete("s", "u", model="legacy", timeout=1) == state.text
        await client.aclose()
        await legacy.aclose()
    with _sdk() as state, _quiet_llm_logs():
        asyncio.run(run(state))


def check_nebius_optional_sdk_and_key_errors() -> None:
    with patch.dict(sys.modules, {"openai": None}):
        try:
            OpenAIClient(api_key="offline-key", provider="nebius")
        except RuntimeError as exc:
            assert "openai" in str(exc) and "--extra openai" in str(exc)
        else:
            raise AssertionError("Nebius must report its optional SDK requirement")
    with _sdk(), patch.dict(os.environ, {}, clear=True):
        try:
            OpenAIClient(provider="nebius")
        except RuntimeError as exc:
            assert "NEBIUS_API_KEY" in str(exc)
        else:
            raise AssertionError("Nebius must require a key")


def check_nebius_tier_config_and_legacy_inheritance() -> None:
    plain = Config(llm_model="direct-legacy-model")
    assert plain.llm_model_fast == plain.llm_model_reasoning == plain.llm_model
    for provider in ("fake", "deepseek", "openai", "anthropic", "nebius"):
        with patch.dict(os.environ, {"FRONTROW_LLM": provider, "FRONTROW_LLM_MODEL": "legacy-env-model"}, clear=True):
            cfg = Config.from_env()
            assert cfg.llm_model_fast == cfg.llm_model_reasoning == "legacy-env-model"
            assert Config.from_env(llm_model="override-model").llm_model_fast == "override-model"
        with patch.dict(os.environ, {"FRONTROW_LLM": provider, "FRONTROW_LLM_MODEL_FAST": "env-fast", "FRONTROW_LLM_MODEL_REASONING": "env-reasoning"}, clear=True):
            cfg = Config.from_env(llm_model="legacy-override")
            assert cfg.llm_model_fast == "env-fast" and cfg.llm_model_reasoning == "env-reasoning"
            cfg = Config.from_env(llm_model_fast="explicit-fast", llm_model_reasoning="explicit-reasoning")
            assert cfg.llm_model_fast == "explicit-fast" and cfg.llm_model_reasoning == "explicit-reasoning"
    with patch.dict(os.environ, {"FRONTROW_LLM": "nebius", "FRONTROW_LLM_MODEL_FAST": "  ", "FRONTROW_LLM_MODEL_REASONING": ""}, clear=True):
        cfg = Config.from_env()
        assert cfg.llm_model_fast == FAST and cfg.llm_model_reasoning == REASONING
    for provider, expected in (("fake", "gpt-4o-mini"), ("openai", "gpt-4o-mini"), ("deepseek", "deepseek-flash"), ("anthropic", "claude-haiku-5-5")):
        with patch.dict(os.environ, {"FRONTROW_LLM": provider}, clear=True):
            cfg = Config.from_env()
            assert cfg.llm_model == cfg.llm_model_fast == cfg.llm_model_reasoning == expected
    with patch.dict(os.environ, {"FRONTROW_LLM": "anthropic"}, clear=True):
        cfg = Config.from_env(provider="nebius")
        assert cfg.llm_model_fast == FAST and cfg.llm_model_reasoning == REASONING
        assert os.environ["FRONTROW_LLM"] == "anthropic", "CLI provider selection must not mutate process settings"


def check_nebius_context_is_task_local_and_observers_cannot_break_calls() -> None:
    before = current_llm_call()
    events = []
    async def worker(tier, role):
        with llm_call_context(tier, role, events.append):
            await asyncio.sleep(0)
            emit_llm_event("test", model=role)
    async def run():
        await asyncio.gather(worker("fast", "reaction"), worker("reasoning", "answer"))
    asyncio.run(run())
    assert {(event["tier"], event["role"]) for event in events} == {("fast", "reaction"), ("reasoning", "answer")}
    assert current_llm_call() == before
    with _quiet_llm_logs(), llm_call_context("fast", "reaction", lambda event: (_ for _ in ()).throw(RuntimeError("offline observer failure"))):
        emit_llm_event("test")
    assert current_llm_call() == before


def check_nebius_real_call_sites_route_and_record_by_role() -> None:
    from frontrow.clock import SimulatedClock
    from frontrow.models import GroundedQuestion, HandRaise
    from frontrow.session import Session
    class Recorder(FakeLLM):
        def __init__(self): self.calls = []
        async def complete(self, system, user, *, model, timeout):
            context = current_llm_call()
            self.calls.append((model, context.tier, context.role))
            emit_llm_event("request", provider="nebius", model=model, latency_seconds=.01,
                usage={"prompt_tokens": 5, "completion_tokens": 2}, finish_reason="stop", outcome="success", error_type=None)
            return await super().complete(system, user, model=model, timeout=timeout)
    async def run():
        llm = Recorder()
        clock = SimulatedClock()
        cfg = Config(llm_model_fast="fast-spy", llm_model_reasoning="reasoning-spy", tick_interval_seconds=300,
                     moderator_warmup_seconds=0, moderator_warmup_min_words=0)
        session = Session(config=cfg, clock=clock, llm=llm)
        try:
            session.start()
            await asyncio.sleep(0)
            await clock.advance(1)
            session.ingest_transcript(0, "A replication quorum keeps reads consistent across replicas.")
            await session.orchestrator.run_tick()
            assert llm.calls.count(("fast-spy", "fast", "reaction")) == 5, llm.calls
            assert llm.calls.count(("fast-spy", "fast", "summary")) == 1, llm.calls
            hand = HandRaise(listener_id="L0", question_id="role-test", persona=session.listeners["L0"].persona.name,
                question=GroundedQuestion(question="Why use a replication quorum?", quote="replication quorum", source="transcript"))
            await session._evaluate(hand, "A replication quorum keeps reads consistent across replicas.")
            assert llm.calls[-1] == ("reasoning-spy", "reasoning", "answer"), llm.calls
            stats = session.llm_stats
            assert stats["tiers"]["fast"]["calls"] == 6 and stats["tiers"]["reasoning"]["calls"] == 1, stats
        finally:
            await session.close()
    with _quiet_llm_logs(): asyncio.run(run())


def check_nebius_usage_prices_latency_and_unknown_costs() -> None:
    ledger = LLMUsage()
    def record(tier, model, latency, usage, outcome="success"):
        ledger.record({"kind": "request", "provider": "nebius", "tier": tier, "role": "answer" if tier == "reasoning" else "reaction",
            "model": model, "latency_seconds": latency, "usage": usage, "outcome": outcome})
    record("fast", FAST, .1, {"prompt_tokens": 100, "completion_tokens": 40, "prompt_tokens_details": {"cached_tokens": 0}})
    record("reasoning", REASONING, .3, {"prompt_tokens": 200, "completion_tokens": 80,
        "prompt_tokens_details": {"cached_tokens": 50}, "completion_tokens_details": {"reasoning_tokens": 60}})
    ledger.record({"kind": "fallback", "tier": "reasoning"})
    snap = ledger.snapshot()
    assert math.isclose(snap["tiers"]["fast"]["cost_usd"], .0000156)
    assert math.isclose(snap["tiers"]["reasoning"]["cost_usd"], .000396)
    totals = snap["totals"]
    assert totals["input_tokens"] == 300 and totals["cached_input_tokens"] == 50
    assert totals["output_tokens"] == 120 and totals["reasoning_tokens"] == 60, "reasoning tokens are already part of completion usage"
    assert totals["calls"] == totals["successes"] == 2 and totals["fallbacks"] == 1
    assert totals["p50_latency_ms"] == 200 and totals["p95_latency_ms"] == 290
    known = totals["known_cost_usd"]
    record("fast", "unpriced-model", .2, {"prompt_tokens": 5, "completion_tokens": 2})
    record("reasoning", REASONING, .4, None, "cancelled")
    totals = ledger.snapshot()["totals"]
    assert totals["cost_usd"] is None and totals["known_cost_usd"] == known
    assert totals["usage_missing_calls"] == totals["unpriced_calls"] == totals["cancelled"] == 1
    assert totals["models"] == sorted([FAST, REASONING, "unpriced-model"])
    assert json.loads(json.dumps(ledger.snapshot())) == ledger.snapshot()
    # A published cache discount without hit counts cannot be priced accurately.
    missing_cache = LLMUsage()
    missing_cache.record({"kind": "request", "provider": "nebius", "tier": "reasoning", "model": REASONING,
        "usage": {"prompt_tokens": 100, "completion_tokens": 40}, "outcome": "success"})
    assert missing_cache.snapshot()["totals"]["cost_usd"] is None
    # No published cache discount means cached prompt tokens use the normal rate.
    cached_nano = LLMUsage()
    cached_nano.record({"kind": "request", "provider": "nebius", "tier": "fast", "model": FAST,
        "usage": {"prompt_tokens": 100, "completion_tokens": 40,
                  "prompt_tokens_details": {"cached_tokens": 50}}, "outcome": "success"})
    cached_stats = cached_nano.snapshot()["totals"]
    assert cached_stats["cached_input_tokens"] == 50 and cached_stats["unpriced_calls"] == 0
    assert cached_stats["cost_usd"] == cached_stats["known_cost_usd"] == .0000156


def check_nebius_fallback_visibility_preserves_billed_usage() -> None:
    async def run(state, stream):
        ledger = LLMUsage()
        reasons = []
        llm = FallbackLLM(OpenAIClient(api_key="offline-key", provider="nebius"), on_fallback=reasons.append)
        state.text = "not valid JSON"
        with llm_call_context("fast", "reaction", ledger.record):
            assert isinstance(await llm.complete_json("s", "u", model=FAST, timeout=1), dict)
        totals = ledger.snapshot()["totals"]
        assert llm.fallback_count == totals["fallbacks"] == len(reasons) == 1
        assert totals["calls"] == 1 and totals["input_tokens"] == 100 and totals["output_tokens"] == 40
        assert totals["cost_usd"] == .0000156, "invalid JSON does not erase a billed SDK response"
        logs = stream.getvalue()
        assert logs.count("llm_fallback ") == 1
        assert f"provider=nebius model={FAST} tier=fast role=reaction" in logs
        assert "not valid JSON" not in logs and "offline-key" not in logs
        await llm.aclose()
    with _sdk() as state, _quiet_llm_logs() as stream: asyncio.run(run(state, stream))


def check_nebius_cancelled_calls_never_trigger_fake_fallback() -> None:
    async def run(state):
        events = []
        state.block = True
        state.started = asyncio.Event()
        llm = FallbackLLM(OpenAIClient(api_key="offline-key", provider="nebius"))
        with llm_call_context("fast", "reaction", events.append):
            task = asyncio.create_task(llm.complete_json("s", "u", model=FAST, timeout=30))
            await state.started.wait()
            task.cancel()
            try: await task
            except asyncio.CancelledError: pass
            else: raise AssertionError("outer listener cancellation must remain cancellation")
        assert llm.fallback_count == 0
        assert len(events) == 1 and events[0]["kind"] == "request" and events[0]["outcome"] == "cancelled", events
        assert events[0]["usage"] is None
        await llm.aclose()
    with _sdk() as state, _quiet_llm_logs(): asyncio.run(run(state))


def check_nebius_errors_and_timeouts_are_redacted_and_counted() -> None:
    async def run(state, stream):
        for timeout in (False, True):
            state.exception = None if timeout else RuntimeError("PRIVATE_PROVIDER_RESPONSE offline-key")
            state.block = timeout
            ledger = LLMUsage()
            llm = FallbackLLM(OpenAIClient(api_key="offline-key", provider="nebius"))
            with llm_call_context("reasoning", "answer", ledger.record):
                assert isinstance(await llm.complete_json("s", "u", model=REASONING, timeout=.01), dict)
            stats = ledger.snapshot()["tiers"]["reasoning"]
            assert stats["calls"] == stats["fallbacks"] == stats["usage_missing_calls"] == 1
            assert stats["cancelled" if timeout else "errors"] == 1
            assert stats["cost_usd"] is None
            assert ledger.requests[0]["error_type"] == ("CancelledError" if timeout else "RuntimeError")
            await llm.aclose()
        assert "PRIVATE_PROVIDER_RESPONSE" not in stream.getvalue() and "offline-key" not in stream.getvalue()
    with _sdk() as state, _quiet_llm_logs() as stream: asyncio.run(run(state, stream))


def check_nebius_shared_client_hooks_and_session_summary_once() -> None:
    from frontrow.clock import SimulatedClock
    from frontrow.models import GroundedQuestion, HandRaise
    from frontrow.session import Session
    async def run(state, stream):
        state.text = "not valid JSON"
        reasons = []
        llm = FallbackLLM(OpenAIClient(api_key="offline-key", provider="nebius"), on_fallback=reasons.append)
        cfg = Config(llm_model_fast=FAST, llm_model_reasoning=REASONING)
        sessions = [Session(config=cfg, clock=SimulatedClock(), llm=llm, session_id=f"offline-shared-{i}") for i in range(2)]
        try:
            for session in sessions:
                session.start()
                hand = HandRaise(listener_id="L0", question_id="shared-question", persona=session.listeners["L0"].persona.name,
                    question=GroundedQuestion(question="Why use a replication quorum?", quote="replication quorum", source="transcript"))
                await session._evaluate(hand, "A replication quorum keeps reads consistent across replicas.")
                await session.end_presenting()
                await session.end_qa()
                session.finish()
                await session.close()
                await session.close()
            assert len(reasons) == llm.fallback_count == 2, "the original callback must survive Session binding"
            for session in sessions:
                stats = session.llm_stats
                assert stats["tiers"]["reasoning"]["calls"] == stats["tiers"]["reasoning"]["fallbacks"] == 1, stats
                assert stats["tiers"]["fast"]["calls"] == 0
                events = [event for event in session.events if event.type == "llm_fallback"]
                assert len(events) == 1 and events[0].data["tier"] == "reasoning" and events[0].data["role"] == "answer", events
                assert stream.getvalue().count(f"llm_session_end session={session.id} ") == 1
        finally:
            for session in sessions: await session.close()
            await llm.aclose()
    with _sdk() as state, _quiet_llm_logs() as stream: asyncio.run(run(state, stream))


NEBIUS_CHECKS = [
    ("Nebius: role options + same-model routing + legacy request shape", check_nebius_provider_options_and_legacy_requests),
    ("Nebius: thinking text cannot shadow response JSON", check_nebius_thinking_text_cannot_shadow_json),
    ("Nebius: optional SDK and missing-key errors", check_nebius_optional_sdk_and_key_errors),
    ("Nebius: tier config defaults, overrides, and legacy inheritance", check_nebius_tier_config_and_legacy_inheritance),
    ("Nebius: task-local context and nonfatal observers", check_nebius_context_is_task_local_and_observers_cannot_break_calls),
    ("Nebius: real reaction / summary / answer call sites", check_nebius_real_call_sites_route_and_record_by_role),
    ("Nebius: per-tier tokens, latency, list-price cost and unknowns", check_nebius_usage_prices_latency_and_unknown_costs),
    ("Nebius: visible fallback retains billed primary usage", check_nebius_fallback_visibility_preserves_billed_usage),
    ("Nebius: outer cancellation never becomes a fake answer", check_nebius_cancelled_calls_never_trigger_fake_fallback),
    ("Nebius: errors and deadlines count once without response leakage", check_nebius_errors_and_timeouts_are_redacted_and_counted),
    ("Nebius: shared-client hooks isolate sessions + one end summary", check_nebius_shared_client_hooks_and_session_summary_once),
]
