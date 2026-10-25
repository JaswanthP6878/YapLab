"""The orchestration core: tick loop, concurrent fan-out, backpressure.

The :class:`Orchestrator` runs a steady tick loop driven by an injected
:class:`~frontrow.clock.Clock`. On each tick it requests the current
transcript window, fans the window out to every listener concurrently with a
per-listener timeout, isolates slow or failing listeners, builds grounded
hand raises, asks the moderator to pick an interruption, and emits a timeline
of events through a pluggable sink.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable

from .agent import Listener
from .clock import Clock
from .config import Config
from .llm.base import LLMClient, LLMObserver, llm_call_context
from .metrics import room_summary
from .models import HandRaise, Reaction, Slide, TimelineEvent
from .moderator import Moderator
from .prompts import build_summary_prompt
from .transcript import TranscriptBuffer

EventSink = Callable[[TimelineEvent], None]


class Orchestrator:
    """Drives the tick loop for a single session."""

    def __init__(
        self,
        config: Config,
        clock: Clock,
        listeners: list[Listener],
        transcript: TranscriptBuffer,
        moderator: Moderator,
        slides: list[Slide] | None = None,
        event_sink: EventSink | None = None,
        summarizer: LLMClient | None = None,
        llm_observer: LLMObserver | None = None,
    ) -> None:
        self._config = config
        self._clock = clock
        self._listeners = listeners
        self._transcript = transcript
        self._moderator = moderator
        self._slides = slides or []
        self._events: list[TimelineEvent] = []
        self._external_sink = event_sink
        self._tick_count = 0
        self._tick_running = False
        self._question_count = 0
        self._current_slide: int | None = None
        # Rolling notes on the whole talk, refreshed after each tick by
        # ``summarizer`` and shared with every listener. None disables it.
        self._summarizer = summarizer
        self._llm_observer = llm_observer
        self._talk_summary = ""
        self._summarized_until = 0.0
        self._talk_started_at: float | None = None
        self._total_word_count = 0
        # Clock time the most recent tick started, or None before any tick.
        self.last_tick_start: float | None = None
        self._inflight_tick: "asyncio.Task[None] | None" = None

    # --- event plumbing ---------------------------------------------------

    @property
    def events(self) -> list[TimelineEvent]:
        """All events emitted so far, in order."""
        return list(self._events)

    def _emit(self, type_: str, **data: object) -> None:
        event = TimelineEvent(type=type_, t=self._clock.now(), data=dict(data))
        self._events.append(event)
        if self._external_sink is not None:
            self._external_sink(event)

    def record(self, type_: str, **data: object) -> None:
        """Record an event from outside the tick loop (e.g. LLM fallbacks)."""
        self._emit(type_, **data)

    def record_hand(self, type_: str, hand: HandRaise, **extra: object) -> None:
        """Record a hand-raise lifecycle event with the question's details."""
        self._emit(
            type_,
            question_id=hand.question_id,
            listener=hand.listener_id,
            persona=hand.persona,
            question=hand.question.question,
            quote=hand.question.quote,
            source=hand.question.source,
            follow_up_of=hand.follow_up_of,
            **extra,
        )

    def next_question_id(self) -> str:
        """Allocate a session-unique question id (``q1``, ``q2``, ...)."""
        self._question_count += 1
        return f"q{self._question_count}"

    @property
    def talk_summary(self) -> str:
        """Notes on the talk so far, as of the last tick."""
        return self._talk_summary

    @property
    def current_slide(self) -> int | None:
        """Index of the slide on screen, or ``None`` if never set."""
        return self._current_slide

    def set_slide(self, index: int | None) -> None:
        """Set the slide on screen; later reactions are tagged with it."""
        self._current_slide = index

    def set_talk_progress(
        self, started_at: float | None, total_word_count: int
    ) -> None:
        """Track the talk's start and accepted words beyond the recent window."""
        self._talk_started_at = started_at
        self._total_word_count = total_word_count

    async def wait_idle(self) -> None:
        """Wait for the in-flight tick, if any, to finish."""
        if self._inflight_tick is not None and not self._inflight_tick.done():
            await self._inflight_tick

    # --- single tick ------------------------------------------------------

    def _start_react(
        self, listener: Listener, window_text: str
    ) -> "asyncio.Task[Reaction | None]":
        """Start a listener's reaction as an independent task."""
        return asyncio.ensure_future(
            listener.react(
                window_text,
                self._slides,
                model=self._config.llm_model_fast,
                timeout=self._config.llm_timeout_seconds,
                clock=self._clock,
                grounding_min_chars=self._config.grounding_min_span_chars,
                current_slide=self._current_slide,
                memory_ticks=self._config.listener_memory_ticks,
                talk_summary=self._talk_summary,
                question_memory=self._config.listener_question_memory,
                talk_elapsed_seconds=(
                    max(0.0, self._clock.now() - self._talk_started_at)
                    if self._talk_started_at is not None
                    else None
                ),
            )
        )

    async def run_tick(self) -> None:
        """Run exactly one tick: fan out, collect, moderate, emit."""
        self._tick_count += 1
        tick_index = self._tick_count
        self.last_tick_start = self._clock.now()
        self._emit("tick_start", tick=tick_index, slide=self._current_slide)

        lowered = self._moderator.expire(self._clock.now())
        if lowered is not None:
            self.record_hand("hand_lowered", lowered, tick=tick_index)

        window_chunks = self._transcript.window(
            self._clock.now(), self._config.transcript_window_seconds
        )
        window_text = self._transcript.full_text(window_chunks)

        if not self._listeners:
            # Zero listeners: complete the tick with no reactions.
            self._emit(
                "tick_complete", tick=tick_index, reactions=0, room=room_summary([])
            )
            return

        # Dispatch all listeners concurrently: each reaction runs as an
        # independent task so no listener waits on another.
        tasks = [
            (listener, self._start_react(listener, window_text))
            for listener in self._listeners
        ]
        react_tasks = [t for _, t in tasks]

        # Enforce the per-listener timeout via the injected clock. We wait
        # until either every reaction is done or the timeout elapses, whichever
        # comes first. Under the real clock fast listeners finish immediately;
        # under the SimulatedClock, advancing time triggers the timeout
        # deterministically. Each react task is independent, so the timeout
        # does NOT cancel siblings — only genuinely slow tasks are cut off.
        timeout = asyncio.ensure_future(
            self._clock.sleep(self._config.per_listener_timeout_seconds)
        )
        pending = set(react_tasks)
        while pending:
            done, pending = await asyncio.wait(
                pending | {timeout}, return_when=asyncio.FIRST_COMPLETED
            )
            if timeout in done:
                # Timeout fired: stop waiting on whatever is still pending.
                pending.discard(timeout)
                break
            # A subset of react tasks finished; keep waiting on the rest.
            pending = pending - {timeout}
        if not timeout.done():
            timeout.cancel()
            try:
                await timeout
            except asyncio.CancelledError:
                pass

        reactions: list[Reaction] = []
        handraises: list[HandRaise] = []

        for listener, task in tasks:
            if not task.done():
                # Still running after the timeout: isolate as a timeout and
                # cancel the task so it does not leak past the tick.
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
                self._emit(
                    "listener_timeout",
                    tick=tick_index,
                    listener=listener.listener_id,
                )
                continue
            if task.cancelled():
                # Defensive: a cancelled task is treated as a timeout.
                self._emit(
                    "listener_timeout",
                    tick=tick_index,
                    listener=listener.listener_id,
                )
                continue
            exc = task.exception()
            if exc is not None:
                self._emit(
                    "listener_error",
                    tick=tick_index,
                    listener=listener.listener_id,
                )
                continue
            reaction = task.result()
            if reaction is None:
                continue
            reactions.append(reaction)
            if listener.last_rejected_question is not None:
                question, quote = listener.last_rejected_question
                self._emit(
                    "grounding_rejected",
                    tick=tick_index,
                    listener=listener.listener_id,
                    question=question,
                    quote=quote,
                )
            self._emit(
                "reaction",
                tick=tick_index,
                listener=reaction.listener_id,
                persona=listener.persona.name,
                slide=reaction.slide,
                attention=reaction.attention,
                confusion=reaction.confusion,
                understood=reaction.understood,
                has_question=reaction.question is not None,
            )
            if listener.last_grounded_question is not None:
                handraises.append(
                    HandRaise(
                        listener_id=listener.listener_id,
                        question=listener.last_grounded_question,
                        question_id=self.next_question_id(),
                        persona=listener.persona.name,
                        confusion=reaction.confusion,
                        tick=tick_index,
                        slide=reaction.slide,
                    )
                )

        raised, pooled = self._moderator.process_tick(
            handraises, self._clock.now(), total_word_count=self._total_word_count
        )

        by_id = {lst.listener_id: lst for lst in self._listeners}
        if raised is not None:
            self.record_hand("hand_raised", raised, tick=tick_index)
            by_id[raised.listener_id].note_question(
                raised.question_id, raised.question.question, "hand raised, not asked yet"
            )
        for h in pooled:
            self.record_hand("pooled", h, tick=tick_index)
            by_id[h.listener_id].note_question(
                h.question_id, h.question.question, "saved for Q&A, not asked yet"
            )

        self._emit(
            "tick_complete",
            tick=tick_index,
            reactions=len(reactions),
            room=room_summary(reactions),
        )
        await self._update_summary(tick_index)

    async def _update_summary(self, tick_index: int) -> None:
        """Fold speech since the last update into the rolling talk summary.

        Runs after ``tick_complete`` so the room score is never delayed; the
        next tick's listeners see the result. A failure keeps the old notes.
        """
        if self._summarizer is None:
            return
        now = self._clock.now()
        new = [c for c in self._transcript.chunks if self._summarized_until < c.end <= now]
        if not new:
            return
        system, user = build_summary_prompt(
            self._talk_summary, self._transcript.full_text(new)
        )
        try:
            with llm_call_context("fast", "summary", self._llm_observer):
                payload = await self._summarizer.complete_json(
                    system,
                    user,
                    model=self._config.llm_model_fast,
                    timeout=self._config.llm_timeout_seconds,
                )
        except Exception as exc:  # noqa: BLE001 - keep the previous notes
            self._emit("summary_error", tick=tick_index, error=type(exc).__name__)
            return
        summary = " ".join(str(payload.get("summary") or "").split())
        if not summary:
            return
        self._talk_summary = summary[: self._config.talk_summary_max_chars]
        self._summarized_until = max(c.end for c in new)
        self._emit("talk_summary", tick=tick_index, summary=self._talk_summary)

    # --- tick loop with backpressure -------------------------------------

    async def _tick_boundary(self) -> None:
        """Handle one cadence boundary: start a tick, or skip if one is live.

        Backpressure lives here: if the previous tick's task has not finished
        by the time the next boundary arrives, we do NOT start another tick.
        Instead we emit ``skipped_tick`` and let the in-flight tick continue.
        At most one tick task is ever in flight per session.
        """
        if self._tick_running:
            self._emit("skipped_tick")
            return
        self._tick_running = True
        task = asyncio.ensure_future(self.run_tick())

        def _clear(_t: "asyncio.Task[None]") -> None:
            self._tick_running = False

        task.add_done_callback(_clear)
        self._inflight_tick = task

    async def run_ticks(self, count: int) -> None:
        """Run up to ``count`` cadence boundaries spaced by ``tick_interval``.

        A tick is started at each boundary unless a prior tick is still in
        flight, in which case the boundary is skipped (``skipped_tick``). This
        makes backpressure observable: with the ``SimulatedClock`` a test can
        make one tick overrun the interval and watch the next boundary skip.
        Designed to be driven by a ``SimulatedClock`` via
        :meth:`~SimulatedClock.advance`.
        """
        for i in range(count):
            await self._tick_boundary()
            if i < count - 1:
                await self._clock.sleep(self._config.tick_interval_seconds)
        # Let any final in-flight tick finish before returning.
        await self.wait_idle()

    async def run_while_presenting(
        self, is_presenting: Callable[[], bool], max_ticks: int | None = None
    ) -> None:
        """Run cadence boundaries while ``is_presenting()`` is true.

        The first tick fires one ``tick_interval`` into the talk, so listeners
        always have speech to react to. Stops starting new ticks once
        presenting ends. ``max_ticks`` bounds the loop for tests/safety.
        """
        n = 0
        while True:
            await self._clock.sleep(self._config.tick_interval_seconds)
            if not is_presenting():
                break
            if max_ticks is not None and n >= max_ticks:
                break
            await self._tick_boundary()
            n += 1
        await self.wait_idle()
