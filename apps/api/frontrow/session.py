"""A single practice session: lifecycle, inputs from the browser, Q&A.

:class:`Session` is the transport-agnostic API the server wraps. It owns the
session state machine and turns frontend inputs into orchestration calls:

* ``ingest_transcript`` takes *final* STT segments. The backend stamps each
  one with its own clock on arrival (``end = now``), so browser and STT
  clocks never need to agree with ours. ``seq`` makes resends idempotent.
* ``change_slide`` tracks what is on screen for slide-tagged reactions.
* ``take_question`` calls on a raised (or pooled) hand. Speech after that is
  the presenter's answer, judged by the asking listener once it closes.
* ``playback_started`` / ``playback_ended`` bracket the agent's question audio
  (TTS); mic input in that window is the agent's own voice echoing back, so
  it is dropped rather than treated as the presenter speaking.

Every event lands on the orchestrator's timeline, which the server streams.
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from dataclasses import dataclass, field

from .agent import Listener
from .clock import Clock
from .config import Config
from .llm.base import LLMClient
from .llm.fallback import FallbackLLM
from .metrics import word_count
from .models import (
    PERMITTED_TRANSITIONS,
    AnswerVerdict,
    HandRaise,
    SessionState,
    Slide,
    TimelineEvent,
    TranscriptChunk,
)
from .moderator import Moderator
from .orchestrator import EventSink, Orchestrator
from .personas import build_room
from .transcript import TranscriptBuffer

# Speaking rate assumed when the client does not send a segment duration.
_DEFAULT_WORDS_PER_SECOND = 2.5


class SessionError(ValueError):
    """A request that is not valid for the session's current state."""


@dataclass
class _OpenAnswer:
    """The presenter's answer to ``hand``, collected until it closes."""

    hand: HandRaise
    parts: list[str] = field(default_factory=list)


class Session:
    """One practice run, from start through Q&A."""

    def __init__(
        self,
        *,
        config: Config,
        clock: Clock,
        llm: LLMClient,
        slides: list[Slide] | None = None,
        preset: str = "default",
        session_id: str | None = None,
        event_sink: EventSink | None = None,
    ) -> None:
        self.id = session_id or uuid.uuid4().hex
        self.preset = preset
        self.state = SessionState.IDLE
        self.slides = slides or []
        self.verdicts: list[AnswerVerdict] = []
        self._config = config
        self._clock = clock
        self._transcript = TranscriptBuffer()
        self.listeners = {
            lid: Listener(lid, persona, llm) for lid, persona in build_room(preset)
        }
        self.moderator = Moderator(config, clock)
        self.orchestrator = Orchestrator(
            config=config,
            clock=clock,
            listeners=list(self.listeners.values()),
            transcript=self._transcript,
            moderator=self.moderator,
            slides=self.slides,
            event_sink=event_sink,
            summarizer=llm,
        )
        if isinstance(llm, FallbackLLM):
            llm.on_fallback = lambda reason: self._record("llm_fallback", reason=reason)

        self._seen_seq: set[int] = set()
        self._last_end = 0.0
        self._loop_task: asyncio.Task[None] | None = None
        self._answer: _OpenAnswer | None = None
        # Echo suppression: mic input is dropped until this clock time.
        self._playback_until: float | None = None
        self._evaluations: set[asyncio.Task[None]] = set()

    # --- plumbing -----------------------------------------------------------

    @property
    def events(self) -> list[TimelineEvent]:
        return self.orchestrator.events

    @property
    def transcript(self) -> list[TranscriptChunk]:
        return self._transcript.chunks

    @property
    def current_slide(self) -> int | None:
        return self.orchestrator.current_slide

    def _record(self, type_: str, **data: object) -> None:
        self.orchestrator.record(type_, **data)

    def _transition(self, target: SessionState) -> None:
        if PERMITTED_TRANSITIONS.get(self.state) is not target:
            raise SessionError(
                f"cannot go from {self.state.value} to {target.value}"
            )
        self.state = target
        self._record("state", state=target.value)

    def _require(self, *states: SessionState) -> None:
        if self.state not in states:
            allowed = ", ".join(s.value for s in states)
            raise SessionError(
                f"not allowed while {self.state.value} (needs {allowed})"
            )

    # --- lifecycle ----------------------------------------------------------

    def start(self) -> None:
        """Idle -> Presenting: start the tick loop."""
        self._transition(SessionState.PRESENTING)
        self._loop_task = asyncio.ensure_future(
            self.orchestrator.run_while_presenting(
                lambda: self.state is SessionState.PRESENTING
            )
        )

    async def end_presenting(self) -> None:
        """Presenting -> QA.

        Stops the tick loop, runs a closing tick if anything was said since
        the last one, closes any open answer, and lowers a raised hand into
        the Q&A pool so it is not lost.
        """
        self._require(SessionState.PRESENTING)
        if self._loop_task is not None:
            self._loop_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._loop_task
        await self.orchestrator.wait_idle()
        last_tick = self.orchestrator.last_tick_start
        if self.transcript and (last_tick is None or last_tick < self._last_end):
            await self.orchestrator.run_tick()
        self._close_answer()
        lowered = self.moderator.lower()
        if lowered is not None:
            self.orchestrator.record_hand("hand_lowered", lowered)
        self._transition(SessionState.QA)
        self._record("qa_pool", size=len(self.moderator.qa_pool))

    async def next_qa_question(self) -> HandRaise | None:
        """Close the current answer, then pick the next Q&A question.

        Waits for the previous answer to be judged first, so a follow-up it
        prompts is asked next. Returns ``None`` when Q&A has nothing left.
        """
        self._require(SessionState.QA)
        self._close_answer()
        await self.drain()
        hand = self.moderator.next_qa(self._clock.now())
        if hand is not None:
            self.orchestrator.record_hand("qa_question", hand)
            self.listeners[hand.listener_id].update_question(
                hand.question_id, "being asked now in Q&A"
            )
            self._answer = _OpenAnswer(hand)
        return hand

    async def end_qa(self) -> None:
        """QA -> Reporting, once every answer has been judged."""
        self._require(SessionState.QA)
        self._close_answer()
        await self.drain()
        self._transition(SessionState.REPORTING)

    def finish(self) -> None:
        """Reporting -> Ended."""
        self._transition(SessionState.ENDED)

    async def drain(self) -> None:
        """Wait for in-flight answer evaluations."""
        while self._evaluations:
            await asyncio.gather(*self._evaluations, return_exceptions=True)

    async def close(self) -> None:
        """Cancel background work (tick loop, evaluations), e.g. on shutdown."""
        tasks = [t for t in (self._loop_task, *self._evaluations) if t is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.orchestrator.wait_idle()

    # --- inputs from the frontend -------------------------------------------

    def ingest_transcript(
        self, seq: int, text: str, duration: float | None = None
    ) -> TranscriptChunk | None:
        """Ingest one final STT segment, stamped with the session clock.

        ``duration`` is the segment's spoken length in seconds; when omitted
        it is estimated from the word count. Returns the stored chunk, or
        ``None`` if the segment was a duplicate ``seq``, empty, or dropped
        because an agent's question audio was playing.
        """
        if self.state is SessionState.ENDED:
            raise SessionError("session has ended")
        self._require(SessionState.PRESENTING, SessionState.QA)
        if seq in self._seen_seq:
            return None
        self._seen_seq.add(seq)
        text = text.strip()
        if not text:
            return None

        now = self._clock.now()
        if self._playback_until is not None and now < self._playback_until:
            self._record("transcript_dropped", seq=seq, text=text, reason="agent_speaking")
            return None

        if duration is None:
            duration = word_count(text) / _DEFAULT_WORDS_PER_SECOND
        start = min(now, max(self._last_end, now - max(duration, 0.0)))
        answer_to = self._answer.hand.question_id if self._answer else None
        chunk = TranscriptChunk(start=start, end=now, text=text, seq=seq, answer_to=answer_to)
        self._transcript.append(chunk)
        self._last_end = now
        if self._answer is not None:
            self._answer.parts.append(text)
        self._record(
            "transcript", seq=seq, start=start, end=now, text=text, answer_to=answer_to
        )
        return chunk

    def change_slide(self, index: int) -> None:
        """The presenter moved to slide ``index``."""
        self._require(SessionState.IDLE, SessionState.PRESENTING, SessionState.QA)
        if self.slides and not 0 <= index < len(self.slides):
            raise SessionError(f"slide {index} out of range (0-{len(self.slides) - 1})")
        if index == self.current_slide:
            return
        self.orchestrator.set_slide(index)
        self._record("slide_change", slide=index)

    def take_question(self, question_id: str) -> HandRaise:
        """The presenter calls on a raised (or pooled) question during the talk."""
        self._require(SessionState.PRESENTING)
        self._close_answer()
        try:
            hand = self.moderator.take(question_id, self._clock.now())
        except ValueError as exc:
            raise SessionError(str(exc)) from exc
        if hand is None:
            raise SessionError(f"unknown question {question_id!r}")
        self.orchestrator.record_hand("question_taken", hand)
        self.listeners[hand.listener_id].update_question(
            hand.question_id, "the presenter called on you; being answered now"
        )
        self._answer = _OpenAnswer(hand)
        return hand

    def answer_done(self, question_id: str) -> None:
        """The presenter finished answering ``question_id``; judge it."""
        if self._answer is not None and self._answer.hand.question_id == question_id:
            self._close_answer()

    def playback_started(self, question_id: str) -> None:
        """An agent's question audio started playing: ignore the mic."""
        now = self._clock.now()
        self._playback_until = now + self._config.playback_max_seconds
        self._record("playback_start", question_id=question_id)

    def playback_ended(self, question_id: str) -> None:
        """The question audio finished: the presenter has the floor again."""
        self._playback_until = None
        self._record("playback_end", question_id=question_id)

    # --- answers ------------------------------------------------------------

    def _close_answer(self) -> None:
        """Close the open answer and judge it in the background."""
        if self._answer is None:
            return
        answer, self._answer = self._answer, None
        self._playback_until = None
        hand = answer.hand
        self.moderator.resolve(hand.question_id)
        text = " ".join(answer.parts)
        self._record(
            "answer", question_id=hand.question_id, listener=hand.listener_id, text=text
        )
        task = asyncio.ensure_future(self._evaluate(hand, text))
        self._evaluations.add(task)
        task.add_done_callback(self._evaluations.discard)

    async def _evaluate(self, hand: HandRaise, text: str) -> None:
        listener = self.listeners[hand.listener_id]
        try:
            verdict = await listener.evaluate_answer(
                hand,
                text,
                model=self._config.llm_model,
                timeout=self._config.llm_timeout_seconds,
                grounding_min_chars=self._config.grounding_min_span_chars,
            )
        except Exception as exc:  # noqa: BLE001 - isolate a failing evaluation
            self._record(
                "answer_eval_error",
                question_id=hand.question_id,
                listener=hand.listener_id,
                error=type(exc).__name__,
            )
            return
        self.verdicts.append(verdict)
        status = f"asked; you judged the answer {verdict.verdict}"
        if verdict.comment:
            status += f": {verdict.comment}"
        listener.update_question(hand.question_id, status)
        self._record(
            "answer_verdict",
            question_id=hand.question_id,
            listener=hand.listener_id,
            persona=hand.persona,
            verdict=verdict.verdict,
            comment=verdict.comment,
        )
        # One follow-up per question, and only while questions are still live.
        if (
            verdict.follow_up is None
            or hand.follow_up_of is not None
            or self.state not in (SessionState.PRESENTING, SessionState.QA)
        ):
            return
        follow = HandRaise(
            listener_id=hand.listener_id,
            question=verdict.follow_up,
            question_id=self.orchestrator.next_question_id(),
            persona=hand.persona,
            confusion=hand.confusion,
            tick=hand.tick,
            slide=hand.slide,
            follow_up_of=hand.question_id,
        )
        raised = self.moderator.add_follow_up(follow, self._clock.now())
        self.orchestrator.record_hand("hand_raised" if raised else "pooled", follow)
        listener.note_question(
            follow.question_id,
            follow.question.question,
            "follow-up raised, not asked yet" if raised else "follow-up saved for Q&A",
        )
