#!/usr/bin/env python3
"""Plain, dependency-light verification for the FrontRow orchestration core.

No pytest. Each check is an ordinary function that raises AssertionError on
failure. Run it directly:

    cd apps/api
    python3 verify.py

It runs fully offline using the deterministic FakeLLM and SimulatedClock, so
it needs no network and no OPENAI_API_KEY. It prints PASS/FAIL per check and
exits non-zero if anything fails.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import traceback
from pathlib import Path

# Always offline, whatever the repo .env selects (set before frontrow loads it;
# the .env never overrides variables that are already set).
os.environ["FRONTROW_LLM"] = "fake"

from frontrow.agent import Listener
from frontrow.clock import RealClock, SimulatedClock
from frontrow.config import Config
from frontrow.grounding import check_grounding
from frontrow.llm.fake import FakeLLM
from frontrow.models import (
    GroundedQuestion,
    HandRaise,
    Slide,
    TranscriptChunk,
)
from frontrow.moderator import Moderator
from frontrow.orchestrator import Orchestrator
from frontrow.personas import build_room
from frontrow.transcript import TranscriptBuffer
from verify_demo_hardening import DEMO_HARDENING_CHECKS
from verify_natural_hands import NATURAL_HAND_CHECKS
from verify_nebius import NEBIUS_CHECKS
from verify_teaching_moves import TEACHING_MOVE_CHECKS
from verify_voice_integration import VOICE_CHECKS

SCENARIO_PATH = (
    Path(__file__).resolve().parents[2] / "scenarios" / "sample_talk.json"
)


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def load_scenario() -> dict:
    with open(SCENARIO_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def scenario_buffer_and_slides() -> tuple[TranscriptBuffer, list[Slide]]:
    data = load_scenario()
    buf = TranscriptBuffer()
    for c in data["chunks"]:
        buf.append(TranscriptChunk(**c))
    slides = [Slide(**s) for s in data.get("slides", [])]
    return buf, slides


async def drive(clock: SimulatedClock, total_seconds: float, step: float = 1.0) -> None:
    """Advance the simulated clock in fine steps, yielding between each.

    Advancing in small increments (with an event-loop yield after each) lets an
    in-flight tick finish its per-listener waits before the next cadence
    boundary arrives, so the loop behaves the way it would under a real clock.
    """
    advanced = 0.0
    while advanced < total_seconds:
        await clock.advance(step)
        await asyncio.sleep(0)
        advanced += step


def build_orchestrator(
    clock: SimulatedClock,
    *,
    preset: str = "default",
    llm: FakeLLM | None = None,
    config: Config | None = None,
    events: list | None = None,
) -> Orchestrator:
    buf, slides = scenario_buffer_and_slides()
    # These fixtures isolate orchestration; natural warm-up has its own checks.
    cfg = config or Config(moderator_warmup_seconds=0, moderator_warmup_min_words=0)
    fake = llm or FakeLLM()
    listeners = [
        Listener(lid, persona, fake) for lid, persona in build_room(preset)
    ]
    mod = Moderator(cfg, clock)
    sink = (lambda e: events.append(e)) if events is not None else None
    return Orchestrator(
        config=cfg,
        clock=clock,
        listeners=listeners,
        transcript=buf,
        moderator=mod,
        slides=slides,
        event_sink=sink,
    )


# --------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------
def check_transcript_windowing() -> None:
    buf = TranscriptBuffer()
    for i in range(5):
        buf.append(TranscriptChunk(start=i * 4.0, end=i * 4.0 + 4.0, text=f"c{i}"))
    # now=20, window=8 -> chunks whose end is within [12, 20] inclusive.
    # c2 ends at 12.0 (included), c3 at 16.0, c4 at 20.0.
    win = buf.window(now=20.0, window_seconds=8.0)
    texts = [c.text for c in win]
    assert texts == ["c2", "c3", "c4"], texts
    # window exceeds elapsed time -> all chunks
    win_all = buf.window(now=20.0, window_seconds=100.0)
    assert len(win_all) == 5, len(win_all)


def check_transcript_rejects_out_of_order() -> None:
    raised = False
    try:
        TranscriptChunk(start=10.0, end=5.0, text="bad")
    except Exception:
        raised = True
    assert raised, "expected TranscriptChunk to reject end < start"


def check_simulated_clock() -> None:
    async def run() -> None:
        clock = SimulatedClock()
        woke: list[float] = []

        async def sleeper(d: float) -> None:
            await clock.sleep(d)
            woke.append(clock.now())

        t1 = asyncio.ensure_future(sleeper(5.0))
        t2 = asyncio.ensure_future(sleeper(10.0))
        await asyncio.sleep(0)
        await clock.advance(5.0)
        assert woke == [5.0], woke  # only the 5s sleeper woke
        await clock.advance(5.0)
        assert woke == [5.0, 10.0], woke
        await asyncio.gather(t1, t2)

        # negative advance rejected
        raised = False
        try:
            await clock.advance(-1.0)
        except ValueError:
            raised = True
        assert raised, "expected negative advance to raise"

    asyncio.run(run())


def check_grounding_rules() -> None:
    transcript = "the CAP theorem says you can only pick two of three"
    slides = [Slide(index=0, text="consistency availability partition tolerance")]

    # real substring >= 10 chars from transcript
    g = check_grounding("why?", "CAP theorem says", transcript, slides, 10)
    assert g is not None and g.source == "transcript", g

    # real substring from a slide
    g2 = check_grounding("what?", "availability partition", transcript, slides, 10)
    assert g2 is not None and g2.source == "slide:0", g2

    # fabricated quote -> rejected
    g3 = check_grounding("x", "quantum entanglement engine", transcript, slides, 10)
    assert g3 is None, g3

    # too short -> rejected
    g4 = check_grounding("x", "CAP", transcript, slides, 10)
    assert g4 is None, g4


def check_agent_reaction_and_grounding() -> None:
    async def run() -> None:
        buf, slides = scenario_buffer_and_slides()
        window_text = buf.full_text()
        _, personas = build_room("default")[0], build_room("default")
        clock = RealClock()
        fake = FakeLLM()

        for lid, persona in personas:
            listener = Listener(lid, persona, fake)
            r = await listener.react(
                window_text,
                slides,
                model="fake",
                timeout=5.0,
                clock=clock,
                grounding_min_chars=10,
            )
            assert r is not None
            assert 0.0 <= r.attention <= 100.0, r.attention
            assert 0.0 <= r.confusion <= 100.0, r.confusion
            # If a question survived, there must be a grounded question stored,
            # and its quote must be a real substring of the source.
            if r.question is not None:
                gq = listener.last_grounded_question
                assert gq is not None
                source_ok = (
                    gq.quote in window_text
                    or any(gq.quote in s.text for s in slides)
                )
                assert source_ok, gq
            # memory updated
            assert len(listener.memory) == 1

    asyncio.run(run())


def check_agent_drops_fabricated_question() -> None:
    """A listener whose LLM returns a bogus quote must drop the question."""

    class BogusLLM(FakeLLM):
        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            return json.dumps(
                {
                    "attention": 70,
                    "confusion": 20,
                    "understood": "fine",
                    "question": "huh?",
                    "quote": "THIS TEXT WAS NEVER SPOKEN AT ALL",
                }
            )

    async def run() -> None:
        listener = Listener("L0", build_room("default")[0][1], BogusLLM())
        r = await listener.react(
            "real transcript content here about systems",
            [],
            model="fake",
            timeout=5.0,
            clock=RealClock(),
            grounding_min_chars=10,
        )
        assert r is not None
        assert r.question is None, "fabricated question should be dropped"
        assert listener.last_grounded_question is None

    asyncio.run(run())


def check_moderator() -> None:
    cfg = Config(moderator_warmup_seconds=0, moderator_warmup_min_words=0)
    clock = SimulatedClock()
    mod = Moderator(cfg, clock)

    def hr(lid: str) -> HandRaise:
        return HandRaise(
            listener_id=lid,
            question=GroundedQuestion(
                question="q", quote="some real quote", source="transcript"
            ),
        )

    # at most one interruption; the rest pooled
    interruption, pooled = mod.process_tick([hr("L2"), hr("L0"), hr("L1")], now=0.0)
    assert interruption is not None
    assert interruption.listener_id == "L0", "deterministic: smallest id wins"
    assert len(pooled) == 2, pooled
    assert len(mod.qa_pool) == 2

    # within the rate-limit gap -> no interruption, everything pooled
    interruption2, pooled2 = mod.process_tick([hr("L3"), hr("L4")], now=1.0)
    assert interruption2 is None, "rate limit should suppress interruption"
    assert len(pooled2) == 2
    assert len(mod.qa_pool) == 4, "pool accumulates with no loss"

    # no hand raises -> no interruption
    interruption3, pooled3 = mod.process_tick([], now=100.0)
    assert interruption3 is None and pooled3 == []


def check_orchestrator_runs() -> None:
    async def run() -> None:
        clock = SimulatedClock()
        events: list = []
        orch = build_orchestrator(clock, events=events)

        async def driver() -> None:
            # 3 ticks spaced by the tick interval
            await orch.run_ticks(3)

        task = asyncio.ensure_future(driver())
        # 3 ticks at 15s cadence => ~45s of virtual time; drive a bit beyond.
        await drive(clock, total_seconds=60.0, step=1.0)
        await task

        types = [e.type for e in events]
        assert types.count("tick_start") == 3, types
        assert types.count("tick_complete") == 3, types
        # every listener reacted on tick 1 (5 listeners in default room)
        tick1_reactions = [
            e for e in events if e.type == "reaction" and e.data["tick"] == 1
        ]
        assert len(tick1_reactions) == 5, len(tick1_reactions)
        # at most one interruption per tick
        for t in (1, 2, 3):
            ints = [
                e
                for e in events
                if e.type == "hand_raised" and e.data["tick"] == t
            ]
            assert len(ints) <= 1, (t, len(ints))

    asyncio.run(run())


def check_orchestrator_isolates_failure() -> None:
    """A listener that raises must be isolated; the tick still completes."""

    class ExplodingLLM(FakeLLM):
        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            raise RuntimeError("boom")

    async def run() -> None:
        clock = SimulatedClock()
        events: list = []
        buf, slides = scenario_buffer_and_slides()
        cfg = Config()
        good = FakeLLM()
        bad = ExplodingLLM()
        room = build_room("default")
        listeners = []
        for i, (lid, persona) in enumerate(room):
            listeners.append(Listener(lid, persona, bad if i == 0 else good))
        orch = Orchestrator(
            config=cfg,
            clock=clock,
            listeners=listeners,
            transcript=buf,
            moderator=Moderator(cfg, clock),
            slides=slides,
            event_sink=events.append,
        )

        task = asyncio.ensure_future(orch.run_ticks(1))
        await drive(clock, total_seconds=30.0, step=1.0)
        await task

        errors = [e for e in events if e.type == "listener_error"]
        completes = [e for e in events if e.type == "tick_complete"]
        reactions = [e for e in events if e.type == "reaction"]
        assert len(errors) == 1, errors
        assert len(completes) == 1, "tick still completes despite a failure"
        assert len(reactions) == 4, "the other 4 listeners still reacted"

    asyncio.run(run())


def check_orchestrator_isolates_timeout() -> None:
    """A listener slower than the per-listener timeout is excluded."""

    class SlowLLM(FakeLLM):
        def __init__(self, clock: SimulatedClock) -> None:
            self._clock = clock

        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            # Sleep longer than the per-listener timeout on the sim clock.
            await self._clock.sleep(1000.0)
            return "{}"

    async def run() -> None:
        clock = SimulatedClock()
        events: list = []
        buf, slides = scenario_buffer_and_slides()
        cfg = Config()
        good = FakeLLM()
        slow = SlowLLM(clock)
        room = build_room("default")
        listeners = [
            Listener(lid, persona, slow if i == 0 else good)
            for i, (lid, persona) in enumerate(room)
        ]
        orch = Orchestrator(
            config=cfg,
            clock=clock,
            listeners=listeners,
            transcript=buf,
            moderator=Moderator(cfg, clock),
            slides=slides,
            event_sink=events.append,
        )

        task = asyncio.ensure_future(orch.run_ticks(1))
        await drive(clock, total_seconds=30.0, step=1.0)
        await task

        timeouts = [e for e in events if e.type == "listener_timeout"]
        completes = [e for e in events if e.type == "tick_complete"]
        assert len(timeouts) == 1, timeouts
        assert len(completes) == 1, "tick completes despite a slow listener"

    asyncio.run(run())


def _run_scenario_timeline() -> list[tuple]:
    """Run the sample scenario once and return a comparable timeline."""

    async def run() -> list[tuple]:
        clock = SimulatedClock()
        events: list = []
        orch = build_orchestrator(clock, events=events)
        task = asyncio.ensure_future(orch.run_ticks(3))
        await drive(clock, total_seconds=60.0, step=1.0)
        await task
        # Compare type + time + sorted data items (ignoring dict ordering).
        return [
            (e.type, e.t, tuple(sorted((k, str(v)) for k, v in e.data.items())))
            for e in events
        ]

    return asyncio.run(run())


def check_determinism() -> None:
    first = _run_scenario_timeline()
    second = _run_scenario_timeline()
    assert first == second, "same scenario must produce an identical timeline"
    assert len(first) > 0


def check_real_clock_is_session_relative() -> None:
    """RealClock starts near 0 so it lines up with transcript chunk times."""
    clock = RealClock()
    assert 0.0 <= clock.now() < 1.0, clock.now()


def check_window_excludes_future_chunks() -> None:
    buf, _ = scenario_buffer_and_slides()
    # window reaches before session start, but chunks ending after now=10 are
    # not spoken yet and must not be returned.
    win = buf.window(now=10.0, window_seconds=30.0)
    assert [c.end for c in win] == [4.0, 8.0], [c.end for c in win]


def check_grounding_tolerates_quote_drift() -> None:
    transcript = "The CAP theorem says  you can only pick two"
    g = check_grounding("why?", "“the cap theorem says you can…”", transcript, [], 10)
    assert g is not None and g.source == "transcript", g
    # the retained span is the exact source text, not the model's version
    assert g.quote == "The CAP theorem says  you can", repr(g.quote)
    assert g.quote in transcript


def check_agent_tolerates_bad_scores() -> None:
    class SloppyLLM(FakeLLM):
        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            return json.dumps({"attention": "high", "confusion": "40%", "understood": None})

    async def run() -> None:
        persona = build_room("default")[1][1]  # skeptical professor
        listener = Listener("L1", persona, SloppyLLM())
        r = await listener.react("some talk text", [], model="m", timeout=1.0, clock=RealClock())
        assert r is not None
        assert r.attention == min(100.0, 50.0 + persona.attention_bias), r.attention
        assert r.confusion == max(0.0, 40.0 + persona.confusion_bias), r.confusion
        assert r.understood == ""

    asyncio.run(run())


def check_fallback_llm() -> None:
    from frontrow.llm.fallback import FallbackLLM

    class Broken(FakeLLM):
        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            raise RuntimeError("api down")

    class NotJson(FakeLLM):
        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            return "sorry, I cannot help with that"

    class Hangs(FakeLLM):
        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            await asyncio.sleep(10)
            return "{}"

    async def run() -> None:
        expected = await FakeLLM().complete_json("s", "u", model="m", timeout=1.0)
        for primary, reason in ((Broken(), "error"), (NotJson(), "error"), (Hangs(), "timeout")):
            reasons: list[str] = []
            llm = FallbackLLM(primary, on_fallback=reasons.append)
            got = await llm.complete_json("s", "u", model="m", timeout=0.05)
            assert got == expected, (type(primary).__name__, got)
            assert len(reasons) == 1 and reasons[0].startswith(reason), reasons

    asyncio.run(run())


def check_moderator_numeric_id_order() -> None:
    mod = Moderator(Config(moderator_warmup_seconds=0, moderator_warmup_min_words=0), SimulatedClock())
    q = GroundedQuestion(question="q", quote="some real quote", source="transcript")
    interruption, _ = mod.process_tick(
        [HandRaise(listener_id="L10", question=q), HandRaise(listener_id="L2", question=q)],
        now=0.0,
    )
    assert interruption is not None and interruption.listener_id == "L2", interruption


def check_config_rejects_bad_tick_interval() -> None:
    for tick in (0.5, 301.0):
        try:
            Config(tick_interval_seconds=tick, per_listener_timeout_seconds=0.1)
        except Exception:
            continue
        raise AssertionError(f"tick interval {tick} should be rejected")


def check_orchestrator_records_grounding_rejection() -> None:
    class BogusLLM(FakeLLM):
        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            return json.dumps(
                {"attention": 60, "confusion": 30, "understood": "ok",
                 "question": "huh?", "quote": "NEVER SAID THIS AT ALL"}
            )

    async def run() -> None:
        clock = SimulatedClock()
        events: list = []
        orch = build_orchestrator(clock, llm=BogusLLM(), events=events)
        await orch.run_tick()
        rejected = [e for e in events if e.type == "grounding_rejected"]
        assert len(rejected) == 5, len(rejected)
        assert not any(e.type in ("hand_raised", "pooled") for e in events)

    asyncio.run(run())


def _replay_sample():
    from frontrow.replay import load_scenario, replay

    return asyncio.run(
        replay(load_scenario(SCENARIO_PATH), llm=FakeLLM(),
               config=Config(moderator_warmup_seconds=0, moderator_warmup_min_words=0))
    )


def check_replay_end_to_end() -> None:
    result = _replay_sample()
    events = result.events
    ticks = [e for e in events if e.type == "tick_complete"]
    # 40s talk at a 15s cadence: ticks at 15s and 30s, plus a closing tick at 40s
    assert [e.t for e in ticks] == [15.0, 30.0, 40.0], [e.t for e in ticks]
    for e in ticks:
        assert e.data["reactions"] == 5, e.data
        assert e.data["room"]["comprehension"] is not None, e.data
    # every question asked quotes real talk, slide, or answer text
    _, slides = scenario_buffer_and_slides()
    spoken = " ".join(
        e.data["text"] for e in events if e.type == "transcript"
    )
    asked = [e for e in events if e.type in ("hand_raised", "pooled", "qa_question")]
    assert asked, "the room should raise questions"
    for e in asked:
        source, quote = e.data["source"], e.data["quote"]
        if source.startswith("slide:"):
            assert quote in slides[int(source.split(":")[1])].text, e.data
        else:
            assert quote in spoken, e.data
    # Q&A ran and every asked question was judged
    qa = [e.data["question_id"] for e in events if e.type == "qa_question"]
    judged = {e.data["question_id"] for e in events if e.type == "answer_verdict"}
    assert qa and set(qa) <= judged, (qa, judged)
    states = [e.data["state"] for e in events if e.type == "state"]
    assert states == ["presenting", "qa", "reporting"], states
    times = [e.t for e in events]
    assert times == sorted(times), "timeline must be nondecreasing"
    # deterministic across runs
    again = _replay_sample()
    assert [e.model_dump() for e in events] == [e.model_dump() for e in again.events]


def _hand(lid: str, qid: str, confusion: float = 0.0, quote: str = "some real quote") -> HandRaise:
    return HandRaise(
        listener_id=lid,
        question_id=qid,
        confusion=confusion,
        question=GroundedQuestion(question="q", quote=quote, source="transcript"),
    )


def check_moderator_hand_lifecycle() -> None:
    cfg = Config(moderator_min_interruption_gap_seconds=60.0, hand_raise_timeout_seconds=45.0,
                 moderator_warmup_seconds=0, moderator_warmup_min_words=0)
    mod = Moderator(cfg, SimulatedClock())

    # most confused listener's hand goes up; the rest are pooled
    raised, pooled = mod.process_tick(
        [_hand("L0", "q1", 20), _hand("L1", "q2", 90), _hand("L2", "q3", 50)], now=0.0
    )
    assert raised is not None and raised.question_id == "q2", raised
    assert {h.question_id for h in pooled} == {"q1", "q3"}

    # while a hand is up, nothing else goes up
    raised, pooled = mod.process_tick([_hand("L3", "q4", 99)], now=15.0)
    assert raised is None and len(pooled) == 1

    # a repeat of a held question from the same listener is dropped
    raised, pooled = mod.process_tick([_hand("L3", "q5", 99)], now=20.0)
    assert raised is None and pooled == [], pooled

    # ignored for 45s -> lowered into the pool
    assert mod.expire(now=30.0) is None
    lowered = mod.expire(now=45.0)
    assert lowered is not None and lowered.question_id == "q2"
    assert mod.active is None

    # presenter calls on a pooled question; rate limit counts from the take
    taken = mod.take("q4", now=50.0)
    assert taken is not None and mod.active_taken
    try:
        mod.take("q1", now=51.0)
    except ValueError:
        pass
    else:
        raise AssertionError("cannot take while another question is being answered")
    assert mod.resolve("q4") is not None and mod.active is None
    raised, _ = mod.process_tick([_hand("L4", "q6", 10)], now=100.0)
    assert raised is None, "rate limit runs from when q4 was asked (t=50)"
    raised, _ = mod.process_tick([_hand("L4", "q7", 10, quote="another real quote")], now=111.0)
    assert raised is not None and raised.question_id == "q7"


def check_moderator_qa_ranking() -> None:
    cfg = Config(qa_max_questions=3, moderator_warmup_seconds=0, moderator_warmup_min_words=0)
    mod = Moderator(cfg, SimulatedClock())
    mod.process_tick(
        [_hand("L0", "q1", 90), _hand("L0", "q2", 80, quote="second quote here"),
         _hand("L1", "q3", 10), _hand("L2", "q4", 50)],
        now=0.0,
    )
    mod.lower()  # q1 (most confused) was raised; lower it into the pool
    order = []
    while (h := mod.next_qa(now=100.0)) is not None:
        order.append(h.question_id)
        # a follow-up is asked next and does not count toward the limit
        if h.question_id == "q4":
            mod.resolve("q4")
            assert mod.add_follow_up(_hand("L2", "q9", 50, quote="follow up quote"), now=101.0)
            continue
        mod.resolve(h.question_id)
    # fairness first (L0, L2, L1 each once by confusion), then L0 again; capped at 3
    assert order == ["q1", "q4", "q9", "q3"], order


def check_session_lifecycle_rules() -> None:
    from frontrow.session import Session, SessionError

    async def run() -> None:
        clock = SimulatedClock()
        session = Session(config=Config(), clock=clock, llm=FakeLLM())
        for bad in (
            lambda: session.ingest_transcript(0, "too early"),
            lambda: session.finish(),
        ):
            try:
                bad()
            except SessionError:
                pass
            else:
                raise AssertionError("expected SessionError")
        session.start()
        await session.end_presenting()
        await session.end_qa()
        session.finish()
        try:
            session.ingest_transcript(1, "after the end")
        except SessionError as exc:
            assert "ended" in str(exc)
        else:
            raise AssertionError("ended session must reject transcript")
        states = [e.data["state"] for e in session.events if e.type == "state"]
        assert states == ["presenting", "qa", "reporting", "ended"], states

    asyncio.run(run())


def check_session_ingest_stamps_dedupes_and_drops_echo() -> None:
    from frontrow.session import Session

    async def run() -> None:
        clock = SimulatedClock()
        session = Session(config=Config(playback_max_seconds=10.0), clock=clock, llm=FakeLLM())
        session.start()
        await clock.advance(5.0)
        c = session.ingest_transcript(0, "hello everyone and welcome", duration=2.0)
        assert c is not None and (c.start, c.end) == (3.0, 5.0), c
        assert session.ingest_transcript(0, "hello everyone and welcome") is None, "dup seq"

        session.playback_started("q1")
        await clock.advance(1.0)
        assert session.ingest_transcript(1, "could you explain that") is None, "echo"
        session.playback_ended("q1")
        assert session.ingest_transcript(2, "sure, here is the answer") is not None

        # frontend never reports playback end -> mic comes back after 10s
        session.playback_started("q2")
        await clock.advance(11.0)
        assert session.ingest_transcript(3, "back to the talk now") is not None
        dropped = [e for e in session.events if e.type == "transcript_dropped"]
        assert len(dropped) == 1, dropped

    asyncio.run(run())


def check_session_take_answer_and_follow_up() -> None:
    from frontrow.session import Session

    class Scripted(FakeLLM):
        """Raises one question on tick 1; judges answers as partial with a follow-up."""

        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            if "[[FRONTROW_ANSWER]]" in system:
                return json.dumps({"verdict": "partial", "comment": "half",
                                   "follow_up": "And the other half?",
                                   "quote": "the network heals"})
            if "PERSONA_NAME: confused first-year" in user and "quorum" in user:
                return json.dumps({"attention": 50, "confusion": 80, "understood": "?",
                                   "question": "What is a quorum?", "quote": "quorum of replicas"})
            return json.dumps({"attention": 70, "confusion": 20, "understood": "ok"})

    async def run() -> None:
        clock = SimulatedClock()
        _, slides = scenario_buffer_and_slides()
        session = Session(config=Config(moderator_warmup_seconds=0, moderator_warmup_min_words=0),
                          clock=clock, llm=Scripted(), slides=slides)
        session.change_slide(1)
        session.start()
        await asyncio.sleep(0)  # let the tick loop register its first sleep
        await clock.advance(10.0)
        session.ingest_transcript(0, "A strongly consistent system needs a quorum of replicas.")
        await clock.advance(5.0)  # tick 1 at t=15
        await session.orchestrator.wait_idle()
        raised = [e for e in session.events if e.type == "hand_raised"]
        assert len(raised) == 1 and raised[0].data["listener"] == "L0", raised
        reactions = [e for e in session.events if e.type == "reaction"]
        assert all(e.data["slide"] == 1 for e in reactions), "reactions tagged with slide"

        qid = raised[0].data["question_id"]
        session.take_question(qid)
        await clock.advance(3.0)
        chunk = session.ingest_transcript(1, "Replicas agree again once the network heals.")
        assert chunk is not None and chunk.answer_to == qid, chunk
        session.answer_done(qid)
        await session.drain()

        verdicts = [e for e in session.events if e.type == "answer_verdict"]
        assert [v.data["verdict"] for v in verdicts] == ["partial"], verdicts
        follow = [e for e in session.events if e.data.get("follow_up_of") == qid]
        assert len(follow) == 1 and follow[0].type == "hand_raised", follow
        assert follow[0].data["source"] == "answer"
        await session.end_presenting()

    asyncio.run(run())


def check_listener_memory_reaches_prompt() -> None:
    class Spy(FakeLLM):
        def __init__(self) -> None:
            self.users: list[str] = []

        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            self.users.append(user)
            return json.dumps({"attention": 33, "confusion": 44, "understood": "tracking"})

    async def run() -> None:
        spy = Spy()
        persona = build_room("default")[4][1]  # domain expert: +15 / -20
        listener = Listener("L4", persona, spy)
        for _ in range(2):
            await listener.react("talk", [], model="m", timeout=1.0, clock=RealClock(),
                                 current_slide=0, memory_ticks=3)
        assert "first stretch" in spy.users[0]
        assert "attention 48, confusion 24: tracking" in spy.users[1], spy.users[1]

    asyncio.run(run())


def check_answer_evaluation_grounds_follow_up() -> None:
    class Judge(FakeLLM):
        def __init__(self, quote: str) -> None:
            self.quote = quote

        async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
            return json.dumps({"verdict": "Partial", "comment": "c",
                               "follow_up": "more?", "quote": self.quote})

    async def run() -> None:
        hand = _hand("L0", "q1")
        persona = build_room("default")[0][1]
        answer = "We retry the write until a quorum acknowledges it."
        ok = await Listener("L0", persona, Judge("until a quorum acknowledges")).evaluate_answer(
            hand, answer, model="m", timeout=1.0)
        assert ok.verdict == "partial" and ok.follow_up is not None, ok
        bad = await Listener("L0", persona, Judge("something never said")).evaluate_answer(
            hand, answer, model="m", timeout=1.0)
        assert bad.follow_up is None, "follow-up must quote the answer"
        empty = await Listener("L0", persona, Judge("x")).evaluate_answer(
            hand, "  ", model="m", timeout=1.0)
        assert empty.verdict == "dodged"

    asyncio.run(run())


class _ScriptedRoom(FakeLLM):
    """Records every prompt; L0 asks one question on its first tick only."""

    def __init__(self, fail_summary_at: int | None = None) -> None:
        self.prompts: list[tuple[str, str]] = []
        self.summaries = 0
        self.fail_summary_at = fail_summary_at

    async def complete(self, system, user, *, model, timeout):  # type: ignore[override]
        self.prompts.append((system, user))
        if "[[FRONTROW_SUMMARY]]" in system:
            self.summaries += 1
            if self.summaries == self.fail_summary_at:
                raise RuntimeError("summary down")
            return json.dumps({"summary": f"NOTES-{self.summaries}"})
        if "[[FRONTROW_ANSWER]]" in system:
            return json.dumps({"verdict": "partial", "comment": "only half of it"})
        if "PERSONA_NAME: confused first-year" in user and "Questions you already raised" not in user:
            return json.dumps({"attention": 50, "confusion": 80, "understood": "?",
                               "question": "What is a quorum?", "quote": "quorum of replicas"})
        return json.dumps({"attention": 70, "confusion": 20, "understood": "ok"})

    def reaction_prompts(self, persona: str) -> list[str]:
        return [u for s, u in self.prompts
                if "[[FRONTROW_REACTION]]" in s and f"PERSONA_NAME: {persona}\n" in u]

    def summary_prompts(self) -> list[str]:
        return [u for s, u in self.prompts if "[[FRONTROW_SUMMARY]]" in s]


async def _room_session(llm: FakeLLM):
    from frontrow.session import Session

    clock = SimulatedClock()
    session = Session(config=Config(moderator_warmup_seconds=0, moderator_warmup_min_words=0),
                      clock=clock, llm=llm)
    session.start()
    await asyncio.sleep(0)

    async def speak_then_tick(seq: int, text: str) -> None:
        await clock.advance(5.0)
        session.ingest_transcript(seq, text)
        await clock.advance(10.0)
        await session.orchestrator.wait_idle()

    return clock, session, speak_then_tick


def check_talk_summary_reaches_next_tick() -> None:
    async def run() -> None:
        llm = _ScriptedRoom(fail_summary_at=3)
        _, session, speak_then_tick = await _room_session(llm)
        await speak_then_tick(0, "Alpha topic: a strongly consistent system needs a quorum of replicas.")
        await speak_then_tick(1, "Beta topic: vector clocks detect concurrent updates.")
        await speak_then_tick(2, "Gamma topic: eventual consistency.")   # summary call fails here
        await speak_then_tick(3, "Delta topic: quorum reads.")

        summaries = llm.summary_prompts()
        # each update sees only speech since the last successful one
        assert "Alpha" in summaries[0] and "Beta" not in summaries[0]
        assert "NOTES-1" in summaries[1] and "Beta" in summaries[1] and "Alpha" not in summaries[1]
        # after the failed 3rd update, the 4th retries Gamma along with Delta
        assert "Gamma" in summaries[3] and "Delta" in summaries[3], summaries[3]
        prompts = llm.reaction_prompts("skeptical professor")
        assert "The talk so far" not in prompts[0], "no notes before the first tick"
        assert "The talk so far, in brief: NOTES-1" in prompts[1]
        assert "The talk so far, in brief: NOTES-2" in prompts[3], "failure keeps old notes"
        events = [e.type for e in session.events]
        assert events.count("talk_summary") == 3 and events.count("summary_error") == 1, events
        await session.close()

    asyncio.run(run())


def check_listener_remembers_its_questions() -> None:
    async def run() -> None:
        llm = _ScriptedRoom()
        clock, session, speak_then_tick = await _room_session(llm)
        await speak_then_tick(0, "A strongly consistent system needs a quorum of replicas.")
        raised = [e for e in session.events if e.type == "hand_raised"]
        assert len(raised) == 1 and raised[0].data["listener"] == "L0", raised
        qid = raised[0].data["question_id"]

        await speak_then_tick(1, "Next, vector clocks.")
        second = llm.reaction_prompts("confused first-year")[1]
        assert '"What is a quorum?" (hand raised, not asked yet)' in second, second

        session.take_question(qid)
        await clock.advance(1.0)
        session.ingest_transcript(2, "A quorum is a majority of replicas.")
        session.answer_done(qid)
        await session.drain()
        await speak_then_tick(3, "Finally, eventual consistency.")
        third = llm.reaction_prompts("confused first-year")[2]
        assert "(asked; you judged the answer partial: only half of it)" in third, third
        # other listeners never see L0's questions
        assert "What is a quorum?" not in llm.reaction_prompts("ESL student")[2]
        await session.close()

    asyncio.run(run())


def _tiny_pdf(texts: list[str]) -> bytes:
    """A minimal valid PDF with one line of text per page."""
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", ""]
    kids = []
    for text in texts:
        page_no, content_no = len(objs) + 1, len(objs) + 2
        kids.append(f"{page_no} 0 R")
        stream = f"BT /F1 18 Tf 72 720 Td ({text}) Tj ET"
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_no} 0 R "
            "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>"
        )
        objs.append(f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
    out, offsets = b"%PDF-1.4\n", []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += "".join(f"{o:010d} 00000 n \n" for o in offsets).encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def check_server_end_to_end() -> None:
    """Drive a whole session over REST + WebSocket with stub speech engines."""
    import signal

    from fastapi.testclient import TestClient

    from frontrow.server import create_app
    from frontrow.speech import SpeechAudio, STTToken

    class StubTTS:
        async def synthesize(self, text, *, persona, listener_id):
            return SpeechAudio(data=f"AUDIO:{listener_id}:{text}".encode(), content_type="audio/mpeg")

    class StubSTT:
        async def create_token(self, session_id):
            return STTToken(token=f"tok-{session_id[:6]}", provider="stub", expires_in_seconds=900,
                            extra={"model_id": "stub-realtime"})

    signal.alarm(60)  # never hang the verifier if the socket loop breaks
    try:
        app = create_app(config=Config(moderator_warmup_seconds=0, moderator_warmup_min_words=0),
                         llm_factory=FakeLLM, tts=StubTTS(), stt_tokens=StubSTT())
        with TestClient(app) as client:
            assert client.get("/health").json()["ok"] is True
            data = load_scenario()

            # REST validation
            assert client.post("/sessions", json={"preset": "nope"}).status_code == 400
            assert client.post("/sessions", json={"tick_interval_seconds": 0.1}).status_code == 400
            assert client.post("/sessions/upload", files={"file": ("a.pdf", b"", "application/pdf")}).status_code == 400
            assert client.post("/sessions/upload", files={"file": ("a.txt", b"hello", "text/plain")}).status_code == 400
            up = client.post("/sessions/upload", files={"file": ("d.pdf", _tiny_pdf(["CAP theorem", "Quorums"]), "application/pdf")})
            assert up.status_code == 201, up.text
            assert [s["text"] for s in up.json()["slides"]] == ["CAP theorem", "Quorums"], up.json()

            r = client.post("/sessions", json={"slides": data["slides"], "tick_interval_seconds": 1.0})
            assert r.status_code == 201, r.text
            info = r.json()
            sid = info["id"]
            assert info["state"] == "idle" and len(info["listeners"]) == 5
            assert client.get(f"/sessions/{sid}/report").status_code == 409
            token = client.post(f"/sessions/{sid}/stt-token").json()
            assert token["token"].startswith("tok-") and token["model_id"] == "stub-realtime", token

            with client.websocket_connect("/sessions/missing/ws") as bad:
                assert bad.receive_json()["type"] == "error"

            seen: list[dict] = []

            def until(ws, pred, limit=2000):
                for _ in range(limit):
                    msg = ws.receive_json()
                    seen.append(msg)
                    if pred(msg):
                        return msg
                raise AssertionError("expected message never arrived")

            def request(ws, msg):
                ws.send_json(msg)
                return until(ws, lambda m: m["type"] in ("ack", "error") and m.get("id") == msg.get("id"))

            with client.websocket_connect(f"/sessions/{sid}/ws") as ws:
                assert ws.receive_json()["type"] == "hello"
                # invalid message -> error, connection stays usable
                err = request(ws, {"type": "bogus", "id": 1})
                assert err["type"] == "error" and err["detail"], err
                assert request(ws, {"type": "ping", "id": 2})["result"] == {"pong": True}
                assert request(ws, {"type": "transcript", "id": 3, "seq": 0, "text": "x"})["type"] == "error"

                assert request(ws, {"type": "slide", "id": 4, "index": 0})["type"] == "ack"
                assert request(ws, {"type": "start", "id": 5})["type"] == "ack"
                for i, c in enumerate(data["chunks"]):
                    ack = request(ws, {"type": "transcript", "id": f"t{i}", "seq": i,
                                       "text": c["text"], "duration": c["end"] - c["start"]})
                    assert ack["result"] == {"accepted": True}, ack
                dup = request(ws, {"type": "transcript", "id": "dup", "seq": 0, "text": "again"})
                assert dup["result"] == {"accepted": False}
                until(ws, lambda m: m["type"] == "event" and m["event"] == "tick_complete")
                assert request(ws, {"type": "end_presenting", "id": 6})["type"] == "ack"

                asked = 0
                while True:
                    ack = request(ws, {"type": "next_question", "id": f"n{asked}"})
                    if ack["result"]["done"]:
                        break
                    asked += 1
                    qid = ack["result"]["question_id"]
                    audio = until(ws, lambda m: m.get("event") == "question_audio"
                                  and m["data"]["question_id"] == qid)
                    got = client.get(audio["data"]["url"])
                    assert got.status_code == 200 and got.content.startswith(b"AUDIO:"), got
                    request(ws, {"type": "playback_started", "id": f"ps{asked}", "question_id": qid})
                    request(ws, {"type": "playback_ended", "id": f"pe{asked}", "question_id": qid})
                    request(ws, {"type": "transcript", "id": f"a{asked}", "seq": 100 + asked,
                                 "text": "Partitions happen, so we trade consistency against availability."})
                assert asked >= 1, "the room should have questions for Q&A"
                assert request(ws, {"type": "end_qa", "id": 7})["type"] == "ack"
                assert request(ws, {"type": "finish", "id": 8})["type"] == "ack"

            events = [m["event"] for m in seen if m["type"] == "event"]
            for name in ("state", "slide_change", "transcript", "tick_complete", "qa_question",
                         "question_audio", "answer", "answer_verdict"):
                assert name in events, (name, sorted(set(events)))
            rep = client.get(f"/sessions/{sid}/report")
            assert rep.status_code == 200, rep.text
            body = rep.json()
            assert body["ticks"] and body["delivery"]["words"] > 0, body
            assert sum(body["questions"]["verdicts"].values()) == asked, body["questions"]
    finally:
        signal.alarm(0)


# --------------------------------------------------------------------------
# runner
# --------------------------------------------------------------------------
CHECKS = [
    ("transcript windowing", check_transcript_windowing),
    ("transcript rejects out-of-order", check_transcript_rejects_out_of_order),
    ("simulated clock wakes sleepers in order", check_simulated_clock),
    ("grounding accepts real / rejects fake quotes", check_grounding_rules),
    ("agent reaction + grounding", check_agent_reaction_and_grounding),
    ("agent drops fabricated question", check_agent_drops_fabricated_question),
    ("moderator at-most-one + rate limit + pool", check_moderator),
    ("orchestrator runs ticks over sample transcript", check_orchestrator_runs),
    ("orchestrator isolates a failing listener", check_orchestrator_isolates_failure),
    ("orchestrator isolates a slow listener", check_orchestrator_isolates_timeout),
    ("determinism: identical timeline across runs", check_determinism),
    ("real clock is session-relative", check_real_clock_is_session_relative),
    ("window excludes chunks not yet spoken", check_window_excludes_future_chunks),
    ("grounding tolerates quote drift, keeps exact span", check_grounding_tolerates_quote_drift),
    ("agent tolerates non-numeric scores", check_agent_tolerates_bad_scores),
    ("fallback LLM on error / bad JSON / timeout", check_fallback_llm),
    ("moderator orders L2 before L10", check_moderator_numeric_id_order),
    ("config rejects out-of-range tick interval", check_config_rejects_bad_tick_interval),
    ("orchestrator records grounding rejections", check_orchestrator_records_grounding_rejection),
    ("replay end-to-end: room score + deterministic", check_replay_end_to_end),
    ("moderator hand lifecycle: raise/expire/take/resolve", check_moderator_hand_lifecycle),
    ("moderator Q&A ranking, follow-ups, limit", check_moderator_qa_ranking),
    ("session state machine rules", check_session_lifecycle_rules),
    ("session ingest: stamping, dedupe, echo drop", check_session_ingest_stamps_dedupes_and_drops_echo),
    ("session take -> answer -> verdict -> follow-up", check_session_take_answer_and_follow_up),
    ("listener memory reaches the prompt", check_listener_memory_reaches_prompt),
    ("answer evaluation grounds follow-ups in the answer", check_answer_evaluation_grounds_follow_up),
    ("talk summary: incremental, shared, survives a failure", check_talk_summary_reaches_next_tick),
    ("listener remembers its own questions and verdicts", check_listener_remembers_its_questions),
    ("server: REST + WebSocket session with stub speech engines", check_server_end_to_end),
]


CHECKS.extend(NATURAL_HAND_CHECKS)
CHECKS.extend(VOICE_CHECKS)
CHECKS.extend(TEACHING_MOVE_CHECKS)
CHECKS.extend(NEBIUS_CHECKS)
CHECKS.extend(DEMO_HARDENING_CHECKS)


def main() -> int:
    passed = 0
    failed = 0
    print(f"Running {len(CHECKS)} checks (offline, FakeLLM + SimulatedClock)\n")
    for name, fn in CHECKS:
        try:
            fn()
        except Exception:  # noqa: BLE001 - we want to report any failure
            failed += 1
            print(f"  FAIL  {name}")
            traceback.print_exc()
            print()
        else:
            passed += 1
            print(f"  PASS  {name}")
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
