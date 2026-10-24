"""Offline regression checks for warm-up, speech-only hands, and bounded pools."""

from __future__ import annotations

import asyncio
import json
import os
import traceback
from unittest.mock import patch

from frontrow.clock import SimulatedClock
from frontrow.config import Config
from frontrow.llm.fake import FakeLLM
from frontrow.metrics import word_count
from frontrow.models import GroundedQuestion, HandRaise
from frontrow.moderator import Moderator
from frontrow.session import Session


def _hand(listener: str, qid: str, confusion: float = 50, *, source: str = "transcript", tick: int = 1) -> HandRaise:
    return HandRaise(listener_id=listener, question_id=qid, confusion=confusion, tick=tick,
                     question=GroundedQuestion(question="Could you explain that?", quote=f"A distinct grounded quote for {qid}", source=source))


def _legacy_config(**kwargs) -> Config:
    return Config(moderator_warmup_seconds=0, moderator_warmup_min_words=0, **kwargs)


def check_natural_warmup_config() -> None:
    defaults = Config()
    assert defaults.moderator_warmup_seconds == 45
    assert defaults.moderator_warmup_min_words == 60
    with patch.dict(os.environ, {"FRONTROW_MODERATOR_WARMUP_SECONDS": "12.5",
                                 "FRONTROW_MODERATOR_WARMUP_MIN_WORDS": "7"}, clear=True):
        configured = Config.from_env()
        assert configured.moderator_warmup_seconds == 12.5
        assert configured.moderator_warmup_min_words == 7
        assert Config.from_env(moderator_warmup_seconds=0, moderator_warmup_min_words=0).moderator_warmup_min_words == 0
    for kwargs in ({"moderator_warmup_seconds": -1}, {"moderator_warmup_min_words": -1}):
        try:
            Config(**kwargs)
        except ValueError:
            pass
        else:
            raise AssertionError(f"negative warm-up value was accepted: {kwargs}")


def check_natural_warmup_boundaries() -> None:
    # Nonzero room clock proves elapsed time is anchored to talk start.
    for now, words in ((100, 100), (144.999, 60), (145, 59), (190, 0)):
        moderator = Moderator(Config(), SimulatedClock(start=100))
        moderator.start(100)
        raised, pooled = moderator.process_tick([_hand("L0", "spoken"), _hand("L1", "slide", source="slide:0")],
                                                now=now, total_word_count=words)
        assert raised is None and pooled == [], (now, words, raised, pooled)
        assert moderator.active is None and moderator.qa_pool == [], "warm-up questions must be dropped, never saved"
    moderator = Moderator(Config(), SimulatedClock(start=100))
    moderator.start(100)
    raised, _ = moderator.process_tick([_hand("L0", "boundary")], now=145, total_word_count=60)
    assert raised is not None and raised.question_id == "boundary", "both thresholds are inclusive"
    unstarted = Moderator(Config(), SimulatedClock())
    assert unstarted.process_tick([_hand("L0", "unstarted")], now=1000, total_word_count=1000) == (None, [])


def check_natural_zero_gate_opt_out() -> None:
    immediate = Moderator(_legacy_config(), SimulatedClock())
    raised, _ = immediate.process_tick([_hand("L0", "immediate")], now=0)
    assert raised is not None, "0/0 must preserve immediate legacy test behavior"
    words_only = Moderator(Config(moderator_warmup_seconds=0), SimulatedClock())
    assert words_only.process_tick([_hand("L0", "few")], now=0, total_word_count=59) == (None, [])
    assert words_only.process_tick([_hand("L0", "enough")], now=0, total_word_count=60)[0] is not None
    time_only = Moderator(Config(moderator_warmup_min_words=0), SimulatedClock())
    time_only.start(100)
    assert time_only.process_tick([_hand("L0", "early")], now=144.999) == (None, [])
    assert time_only.process_tick([_hand("L0", "ready")], now=145)[0] is not None


class _ScriptedProgress(FakeLLM):
    """Always offers one real speech quote, independent of model randomness."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def complete(self, system, user, *, model, timeout):
        self.calls.append((system, user))
        if "[[FRONTROW_SUMMARY]]" in system:
            return json.dumps({"summary": "The accepted speech introduced quorum and learning."})
        if "[[FRONTROW_REACTION]]" in system:
            payload = {"attention": 70, "confusion": 40, "understood": "following the accepted speech"}
            if "PERSONA_NAME: confused first-year\n" in user:
                payload.update(question="What is a quorum?", quote="quorum of replicas")
            return json.dumps(payload)
        return await super().complete(system, user, model=model, timeout=timeout)

    def first_year_prompts(self) -> list[tuple[str, str]]:
        return [(system, user) for system, user in self.calls
                if "[[FRONTROW_REACTION]]" in system and "PERSONA_NAME: confused first-year\n" in user]


def check_natural_session_accepted_words_and_prompt_history() -> None:
    async def run() -> None:
        llm = _ScriptedProgress()
        clock = SimulatedClock(start=100)
        # Drive explicit ticks; the normal cadence cannot interfere with boundary checks.
        session = Session(config=Config(tick_interval_seconds=300), clock=clock, llm=llm)
        try:
            session.start()
            await asyncio.sleep(0)
            await clock.advance(20)
            fifty_nine = "quorum of replicas " + " ".join(["lesson"] * 56)
            assert word_count(fifty_nine) == 59
            assert session.ingest_transcript(0, fifty_nine, duration=20) is not None
            assert session.ingest_transcript(0, " ".join(["duplicate"] * 100)) is None
            assert session.ingest_transcript(1, "   ") is None
            session.playback_started("guarded-test-question")
            assert session.ingest_transcript(2, " ".join(["echo"] * 100)) is None
            session.playback_ended("guarded-test-question")
            assert session.ingest_transcript(2, "replayed dropped segment") is None
            await clock.advance(25)
            await session.orchestrator.run_tick()
            assert not any(e.type in ("hand_raised", "pooled") for e in session.events), "only 59 accepted words, despite duplicate/echo attempts"
            assert session.moderator.qa_pool == []
            assert all(not listener.questions for listener in session.listeners.values()), "dropped warm-up questions must not pollute question memory"
            assert len(session.listeners["L0"].memory) == 1, "warm-up still preserves listener understanding"

            assert session.ingest_transcript(3, "learning", duration=0) is not None
            await session.orchestrator.run_tick()
            raised = [e for e in session.events if e.type == "hand_raised"]
            assert len(raised) == 1 and raised[0].data["source"] == "transcript"
            assert word_count(" ".join(chunk.text for chunk in session.transcript)) == 60
            system, prompt = llm.first_year_prompts()[-1]
            assert "The presenter has been speaking for 45 seconds." in prompt
            assert "Most of the time, do not ask." in system
            assert "[[FRONTROW_REACTION]]" in system and "JSON object" in system
            assert "How you felt over the last few stretches" in prompt, "elapsed context must keep existing reaction memory"
            assert "The talk so far, in brief:" in prompt, "existing rolling talk notes must remain"

            # Previously accepted words count after they leave the recent transcript window.
            session.moderator.resolve(raised[0].data["question_id"])
            await clock.advance(40)
            assert session.ingest_transcript(4, "quorum of replicas", duration=1) is not None
            await session.orchestrator.run_tick()
            assert len([e for e in session.events if e.type == "hand_raised"]) == 2, "cumulative word gate must not reset with the rolling window"
            _, later = llm.first_year_prompts()[-1]
            assert "The presenter has been speaking for 85 seconds." in later
            assert "Questions you already raised" in later and "What is a quorum?" in later
        finally:
            await session.close()

    asyncio.run(run())


def check_natural_speech_and_slide_sources() -> None:
    moderator = Moderator(_legacy_config(), SimulatedClock())
    slide = _hand("L0", "slide-high", 99, source="slide:0")
    speech = _hand("L1", "speech-low", 20)
    raised, pooled = moderator.process_tick([slide, speech], now=0)
    assert raised is speech and pooled == [slide], "a more confused slide question must not steal the mid-talk floor"
    slide_only = Moderator(_legacy_config(), SimulatedClock())
    assert slide_only.process_tick([slide], now=0) == (None, [slide])
    assert slide_only.active is None
    assert slide_only.next_qa(now=1) is slide, "slide questions remain available during Q&A"
    answer = _hand("L2", "answer", source="answer")
    follow = Moderator(_legacy_config(), SimulatedClock())
    assert follow.process_tick([answer], now=0)[0] is answer


def check_natural_pool_highest_per_tick_and_latest_two() -> None:
    moderator = Moderator(_legacy_config(), SimulatedClock())
    moderator.process_tick([_hand("L9", "active")], now=0)
    low = _hand("L0", "low", 20)
    high = _hand("L0", "high", 90)
    middle = _hand("L0", "middle", 70)
    other = _hand("L1", "other", 50)
    raised, pooled = moderator.process_tick([low, high, middle, other], now=1)
    assert raised is None and {h.question_id for h in pooled} == {"high", "other"}
    assert len([h for h in pooled if h.listener_id == "L0"]) == 1
    moderator.process_tick([_hand("L0", "later", 40, tick=2)], now=2)
    moderator.process_tick([_hand("L0", "latest", 10, tick=3)], now=3)
    assert [h.question_id for h in moderator.qa_pool if h.listener_id == "L0"] == ["later", "latest"], "evict the oldest, not the lowest-confusion question"
    assert [h.question_id for h in moderator.qa_pool if h.listener_id == "L1"] == ["other"]
    duplicate = _hand("L0", "duplicate-id", 100)
    duplicate.question.quote = next(h.question.quote for h in moderator.qa_pool if h.question_id == "latest")
    assert moderator.process_tick([duplicate], now=4) == (None, [])


def _full_listener_pool() -> Moderator:
    moderator = Moderator(_legacy_config(hand_raise_timeout_seconds=10), SimulatedClock())
    moderator.process_tick([_hand("L0", "raised")], now=0)
    moderator.process_tick([_hand("L0", "oldest", tick=2)], now=1)
    moderator.process_tick([_hand("L0", "newer", tick=3)], now=2)
    assert len(moderator.qa_pool) == 2, "the active hand is not part of the two-question pool cap"
    return moderator


def check_natural_pool_cap_all_entry_paths() -> None:
    for expire in (False, True):
        moderator = _full_listener_pool()
        if expire:
            assert moderator.expire(now=9.999) is None
            lowered = moderator.expire(now=10)
        else:
            lowered = moderator.lower()
        assert lowered is not None and lowered.question_id == "raised"
        assert [h.question_id for h in moderator.qa_pool] == ["newer", "raised"]
    moderator = _full_listener_pool()
    first = _hand("L0", "follow-one", source="answer")
    second = _hand("L0", "follow-two", source="answer")
    assert not moderator.add_follow_up(first, now=3)
    assert not moderator.add_follow_up(second, now=4)
    assert [h.question_id for h in moderator.qa_pool] == ["follow-one", "follow-two"]


def check_natural_take_reserves_oldest_before_lowering() -> None:
    moderator = _full_listener_pool()
    taken = moderator.take("oldest", now=3)
    assert taken is not None and taken.question_id == "oldest"
    assert moderator.active_taken and moderator.active is taken
    assert [h.question_id for h in moderator.qa_pool] == ["newer", "raised"]
    assert moderator.last_interruption_time == 3


def check_natural_follow_up_priority_unchanged() -> None:
    moderator = Moderator(_legacy_config(qa_max_questions=0), SimulatedClock())
    moderator.process_tick([_hand("L0", "original")], now=0)
    moderator.take("original", now=0)
    moderator.resolve("original")
    follow = _hand("L0", "follow", source="answer")
    assert moderator.add_follow_up(follow, now=1), "answer follow-ups still bypass the ordinary interruption gap"
    assert moderator.next_qa(now=2) is follow, "a raised follow-up still bypasses the normal Q&A count limit"


NATURAL_HAND_CHECKS = [
    ("natural hands: default/configurable warm-up and validation", check_natural_warmup_config),
    ("natural hands: nonzero start, inclusive AND gates, drop not pool", check_natural_warmup_boundaries),
    ("natural hands: 0/0 opt-out and individually disabled gates", check_natural_zero_gate_opt_out),
    ("natural hands: accepted cumulative words and existing prompt history", check_natural_session_accepted_words_and_prompt_history),
    ("natural hands: speech may interrupt, slide questions wait for Q&A", check_natural_speech_and_slide_sources),
    ("natural hands: highest per listener/tick, newest two held", check_natural_pool_highest_per_tick_and_latest_two),
    ("natural hands: pool cap through lower, expire, and follow-up", check_natural_pool_cap_all_entry_paths),
    ("natural hands: taking oldest pooled question reserves it before lower", check_natural_take_reserves_oldest_before_lowering),
    ("natural hands: answer follow-up priority stays unchanged", check_natural_follow_up_priority_unchanged),
]


if __name__ == "__main__":
    failures = 0
    for name, check in NATURAL_HAND_CHECKS:
        try:
            check()
        except Exception:
            failures += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"PASS {name}")
    print(f"{len(NATURAL_HAND_CHECKS) - failures} passed, {failures} failed")
    raise SystemExit(bool(failures))
