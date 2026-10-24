"""Replay a scripted talk through the full orchestration core, no frontend.

Feeds a scenario's transcript and slides through the orchestrator on a
simulated clock, then prints a per-tick room score (attention, confusion,
comprehension, speaking rate, hands raised), the hands raised during the
talk, the Q&A with each answer's verdict, and overall delivery stats. Works offline with the deterministic FakeLLM, or
against a real model (falling back to the FakeLLM per request on failure).

    cd apps/api
    uv run python -m frontrow.replay                       # sample talk, fake LLM
    uv run python -m frontrow.replay ../../scenarios/sample_talk.json --print-timeline
    uv run --extra openai python -m frontrow.replay --llm deepseek  # needs DEEPSEEK_API_KEY
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path

from .clock import SimulatedClock
from .config import Config
from .llm.base import LLMClient
from .llm.fake import FakeLLM
from .llm.fallback import FallbackLLM
from .llm.openai_client import PROVIDERS, OpenAIClient
from .metrics import filler_count, longest_pause, speaking_rate, word_count
from .models import HandRaise, Slide, TimelineEvent, TranscriptChunk
from .session import Session

DEFAULT_SCENARIO = (
    Path(__file__).resolve().parents[3] / "scenarios" / "sample_talk.json"
)


@dataclass
class Scenario:
    """A scripted talk: timed transcript, slides, and scripted Q&A answers.

    Chunks may carry a ``slide`` index (the slide on screen while it is
    spoken). ``qa_answers`` are the presenter's answers to Q&A questions, in
    order; a question with no scripted answer gets an empty (dodged) answer.
    """

    name: str
    chunks: list[TranscriptChunk]
    slides: list[Slide]
    qa_answers: list[str]


@dataclass
class ReplayResult:
    """Everything a replay produced, for printing or assertions."""

    name: str
    events: list[TimelineEvent]
    chunks: list[TranscriptChunk]
    qa_pool: list[HandRaise]
    personas: dict[str, str]
    duration: float


def load_scenario(path: Path) -> Scenario:
    """Load a :class:`Scenario` from a JSON file."""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    chunks = sorted(
        (TranscriptChunk(**c) for c in data.get("chunks", [])), key=lambda c: c.end
    )
    return Scenario(
        name=data.get("name", path.stem),
        chunks=chunks,
        slides=[Slide(**s) for s in data.get("slides", [])],
        qa_answers=list(data.get("qa_answers", [])),
    )


def make_llm(kind: str) -> LLMClient:
    """Build the LLM client for ``kind`` (``fake``, ``deepseek``, or ``openai``)."""
    if kind == "fake":
        return FakeLLM()
    if kind in PROVIDERS:
        return FallbackLLM(OpenAIClient(provider=kind))
    raise ValueError(f"unknown llm kind: {kind!r}")


async def _advance_to(
    clock: SimulatedClock, session: Session, target: float, step: float
) -> None:
    """Advance simulated time to ``target``, letting each tick finish first.

    Time only moves once the in-flight tick is done, so a slow real model
    never trips the simulated per-listener timeout (``FallbackLLM`` bounds
    real latency instead).
    """
    while clock.now() < target:
        await clock.advance(min(step, target - clock.now()))
        await session.orchestrator.wait_idle()


async def replay(
    scenario: Scenario,
    *,
    llm: LLMClient,
    config: Config,
    preset: str = "default",
    step: float = 1.0,
) -> ReplayResult:
    """Run a scripted talk through a :class:`Session` on a simulated clock.

    Each chunk is ingested when it finishes being spoken, exactly as the
    frontend would forward final STT segments, with slide changes sent as
    the chunk starts. The scripted presenter ignores hands raised during the
    talk (they are lowered into the Q&A pool), then answers Q&A questions
    with ``scenario.qa_answers``.
    """
    clock = SimulatedClock()
    session = Session(
        config=config, clock=clock, llm=llm, slides=scenario.slides, preset=preset
    )
    seq = 0
    session.start()
    await asyncio.sleep(0)  # let the tick loop register its first sleep

    for chunk in scenario.chunks:
        await _advance_to(clock, session, chunk.start, step)
        slide = getattr(chunk, "slide", None)
        if slide is not None:
            session.change_slide(slide)
        await _advance_to(clock, session, chunk.end, step)
        session.ingest_transcript(seq, chunk.text, duration=chunk.end - chunk.start)
        seq += 1
    duration = clock.now()
    await session.end_presenting()

    answers = iter(scenario.qa_answers)
    while (hand := await session.next_qa_question()) is not None:
        answer = next(answers, "")
        speaking_time = max(2.0, word_count(answer) / 2.5)
        await _advance_to(clock, session, clock.now() + speaking_time, step)
        if answer:
            session.ingest_transcript(seq, answer, duration=speaking_time)
            seq += 1
    await session.end_qa()

    return ReplayResult(
        name=scenario.name,
        events=session.events,
        chunks=[c for c in session.transcript if getattr(c, "answer_to", None) is None],
        qa_pool=session.moderator.qa_pool,
        personas={lid: lst.persona.name for lid, lst in session.listeners.items()},
        duration=duration,
    )


# --- printing --------------------------------------------------------------


def _fmt(value: float | None, width: int = 5) -> str:
    return f"{value:{width}.0f}" if value is not None else " " * (width - 1) + "-"


def print_summary(result: ReplayResult) -> None:
    """Print the per-tick room score, questions and answers, and delivery stats."""
    events = result.events
    ticks = [e for e in events if e.type == "tick_complete"]
    starts = {e.data["tick"]: e for e in events if e.type == "tick_start"}

    print(f"Room score per tick  ({result.name}, {len(result.personas)} listeners)\n")
    print("  tick      t  slide   wpm  atten  confus  compr  hands  hand raised")
    prev_t = 0.0
    for e in ticks:
        tick = e.data["tick"]
        start = starts.get(tick, e)
        t = start.t
        slide = start.data.get("slide")
        room = e.data.get("room", {})
        hands = sum(
            1
            for r in events
            if r.type == "reaction" and r.data["tick"] == tick and r.data["has_question"]
        )
        raised = next(
            (
                r
                for r in events
                if r.type == "hand_raised" and r.data.get("tick") == tick
            ),
            None,
        )
        who = f"{raised.data['listener']} ({raised.data['persona']})" if raised else ""
        wpm = speaking_rate(result.chunks, prev_t, t)
        print(
            f"  {tick:4d}  {t:5.0f}  {_fmt(slide)}  {_fmt(wpm)}  {_fmt(room.get('attention'))}"
            f"  {_fmt(room.get('confusion'), 6)}  {_fmt(room.get('comprehension'))}"
            f"  {hands:5d}  {who}"
        )
        prev_t = t

    print("\nHands during the talk:")
    for e in events:
        if e.type == "state" and e.data["state"] == "qa":
            break
        if e.type in ("hand_raised", "hand_lowered", "question_taken"):
            print(f"  t={e.t:4.0f} {e.type:14s} {e.data['question_id']:4s} "
                  f"[{e.data['listener']} {e.data['persona']}] {e.data['question']}")

    verdicts = {e.data["question_id"]: e.data for e in events if e.type == "answer_verdict"}
    answers = {e.data["question_id"]: e.data["text"] for e in events if e.type == "answer"}
    asked = [e for e in events if e.type == "qa_question"]
    print(f"\nQ&A ({len(asked)} asked, {len(result.qa_pool)} left in pool):")
    for e in asked:
        qid = e.data["question_id"]
        tag = f" (follow-up to {e.data['follow_up_of']})" if e.data.get("follow_up_of") else ""
        print(f"  {qid} [{e.data['listener']} {e.data['persona']}]{tag} {e.data['question']}")
        print(f"       quote: \"{e.data['quote']}\" ({e.data['source']})")
        print(f"       answer: {answers.get(qid) or '(no answer)'}")
        v = verdicts.get(qid)
        if v:
            print(f"       verdict: {v['verdict']}  - {v['comment']}")
    if verdicts:
        counts = {k: sum(1 for v in verdicts.values() if v["verdict"] == k)
                  for k in ("answered", "partial", "dodged")}
        print("  answers: " + ", ".join(f"{n} {k}" for k, n in counts.items()))

    rejected = sum(1 for e in events if e.type == "grounding_rejected")
    failed = sum(1 for e in events if e.type in ("listener_timeout", "listener_error"))
    fallbacks = sum(1 for e in events if e.type == "llm_fallback")
    text = " ".join(c.text for c in result.chunks)
    words = word_count(text)
    print("\nDelivery:")
    print(f"  duration {result.duration:.0f}s, {words} words, "
          f"{speaking_rate(result.chunks, 0.0, result.duration) or 0:.0f} wpm overall")
    print(f"  filler words {filler_count(text)}, longest pause {longest_pause(result.chunks)}s")
    print(f"  ungrounded questions rejected {rejected}, listener timeouts/errors {failed}, "
          f"LLM fallbacks {fallbacks}")


def print_timeline(events: list[TimelineEvent]) -> None:
    print("\nTimeline:")
    for e in events:
        print(f"  t={e.t:7.2f}  {e.type:18s}  {json.dumps(e.data, default=str)}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Replay a scripted talk through FrontRow.")
    p.add_argument("scenario", nargs="?", type=Path, default=DEFAULT_SCENARIO)
    p.add_argument("--llm", default="fake", choices=["fake", *PROVIDERS])
    p.add_argument("--model", default=None, help="model name (default from config)")
    p.add_argument("--preset", default="default")
    p.add_argument("--tick", type=float, default=None, help="tick interval seconds")
    p.add_argument("--print-timeline", action="store_true")
    p.add_argument("--out", type=Path, help="write the event timeline as JSON")
    args = p.parse_args(argv)

    overrides: dict[str, object] = {}
    if args.model:
        overrides["llm_model"] = args.model
    elif args.llm in PROVIDERS and not os.environ.get("FRONTROW_LLM_MODEL"):
        overrides["llm_model"] = PROVIDERS[args.llm].default_model
    if args.tick:
        overrides["tick_interval_seconds"] = args.tick
        overrides["per_listener_timeout_seconds"] = min(10.0, args.tick * 2 / 3)
    config = Config.from_env(**overrides)

    scenario = load_scenario(args.scenario)
    result = asyncio.run(
        replay(scenario, llm=make_llm(args.llm), config=config, preset=args.preset)
    )
    print(f"llm={args.llm} model={config.llm_model} preset={args.preset} "
          f"tick={config.tick_interval_seconds:g}s\n")
    print_summary(result)
    if args.print_timeline:
        print_timeline(result.events)
    if args.out:
        args.out.write_text(
            json.dumps([e.model_dump() for e in result.events], indent=2, default=str)
        )
        print(f"\nwrote {len(result.events)} events to {args.out}")


if __name__ == "__main__":
    main()
