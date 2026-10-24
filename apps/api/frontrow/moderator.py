"""Moderator: decides who gets the floor and pools the rest for Q&A.

The room behaves like a class: at most one hand is up at a time. A tick's best
question is *raised* and waits for the presenter to call on it (``take``);
once taken it is *active* until the presenter's answer is *resolved*. While a
hand is up or being answered, every new question goes to the Q&A pool, and a
raised hand the presenter ignores is lowered into the pool after
``hand_raise_timeout_seconds``. The interruption rate limit is measured from
when a question was last actually asked, by the injected clock.

Ranking (deterministic): listeners who have been called on least go first,
then the most confused, then the lowest listener id (numeric-aware).
"""

from __future__ import annotations

import re

from .clock import Clock
from .config import Config
from .models import HandRaise

_ID_RE = re.compile(r"(\d+)")


def listener_sort_key(listener_id: str) -> tuple:
    """Sort key that orders embedded numbers numerically (``L2`` < ``L10``)."""
    return tuple(
        (0, int(part)) if part.isdigit() else (1, part)
        for part in _ID_RE.split(listener_id)
        if part
    )


class Moderator:
    """Selects who speaks, tracks the hand-raise lifecycle, keeps the Q&A pool."""

    def __init__(self, config: Config, clock: Clock) -> None:
        self._config = config
        self._clock = clock
        self._qa_pool: list[HandRaise] = []
        # Clock time a question was last asked (taken), for the rate limit.
        self._last_interruption_time: float | None = None
        # The hand currently up (raised) or being answered (taken).
        self._active: HandRaise | None = None
        self._active_taken = False
        self._raised_at = 0.0
        self._times_called: dict[str, int] = {}
        self._qa_asked = 0

    @property
    def qa_pool(self) -> list[HandRaise]:
        """The accumulated pool of deferred hand raises."""
        return list(self._qa_pool)

    @property
    def last_interruption_time(self) -> float | None:
        """Clock time a question was most recently asked, or ``None``."""
        return self._last_interruption_time

    @property
    def active(self) -> HandRaise | None:
        """The hand currently raised or being answered, if any."""
        return self._active

    @property
    def active_taken(self) -> bool:
        """Whether the active hand has been called on (is being answered)."""
        return self._active is not None and self._active_taken

    def _rate_limited(self, now: float) -> bool:
        """Whether the interruption rate limit is currently in effect."""
        if self._last_interruption_time is None:
            return False
        gap = self._config.moderator_min_interruption_gap_seconds
        return (now - self._last_interruption_time) < gap

    def _rank_key(self, h: HandRaise) -> tuple:
        return (
            self._times_called.get(h.listener_id, 0),
            -h.confusion,
            listener_sort_key(h.listener_id),
        )

    def _select(self, handraises: list[HandRaise]) -> HandRaise:
        """Deterministically choose the best hand raise from a non-empty list."""
        return min(handraises, key=self._rank_key)

    def _is_duplicate(self, h: HandRaise) -> bool:
        """Same listener asking about the same quote as a held question."""
        held = [*self._qa_pool, *([self._active] if self._active else [])]
        return any(
            p.listener_id == h.listener_id and p.question.quote == h.question.quote
            for p in held
        )

    def _mark_called(self, h: HandRaise, now: float) -> None:
        self._active = h
        self._active_taken = True
        self._last_interruption_time = now
        self._times_called[h.listener_id] = self._times_called.get(h.listener_id, 0) + 1

    # --- presenting -------------------------------------------------------

    def process_tick(
        self, handraises: list[HandRaise], now: float
    ) -> tuple[HandRaise | None, list[HandRaise]]:
        """Process one tick's hand raises.

        Returns ``(raised, pooled_this_tick)``. ``raised`` is the hand that
        goes up and waits for the presenter; it is ``None`` when a hand is
        already up or being answered, or the rate limit is in effect. Repeats
        of a question the same listener already has held are dropped.
        """
        fresh = [h for h in handraises if not self._is_duplicate(h)]
        if not fresh:
            return None, []

        if self._active is not None or self._rate_limited(now):
            self._qa_pool.extend(fresh)
            return None, list(fresh)

        raised = self._select(fresh)
        self._active = raised
        self._active_taken = False
        self._raised_at = now
        pooled = [h for h in fresh if h is not raised]
        self._qa_pool.extend(pooled)
        return raised, pooled

    def expire(self, now: float) -> HandRaise | None:
        """Lower a raised hand the presenter has ignored for too long.

        The question moves to the Q&A pool. Returns the lowered hand, if any.
        """
        if self._active is None or self._active_taken:
            return None
        if now - self._raised_at < self._config.hand_raise_timeout_seconds:
            return None
        return self.lower()

    def lower(self) -> HandRaise | None:
        """Lower the raised (not yet taken) hand into the Q&A pool."""
        if self._active is None or self._active_taken:
            return None
        hand = self._active
        self._active = None
        self._qa_pool.append(hand)
        return hand

    def take(self, question_id: str, now: float) -> HandRaise | None:
        """The presenter calls on ``question_id`` (the raised hand or a pooled one).

        Taking a pooled question lowers any other raised hand into the pool.
        Returns ``None`` for an unknown id. Raises ``ValueError`` if another
        question is still being answered.
        """
        if self._active is not None and self._active.question_id == question_id:
            if not self._active_taken:
                self._mark_called(self._active, now)
            return self._active
        match = next((h for h in self._qa_pool if h.question_id == question_id), None)
        if match is None:
            return None
        if self._active_taken:
            raise ValueError(
                f"question {self._active.question_id} is still being answered"
            )
        self.lower()
        self._qa_pool.remove(match)
        self._mark_called(match, now)
        return match

    def resolve(self, question_id: str) -> HandRaise | None:
        """Mark the active question as answered, freeing the floor."""
        if self._active is None or self._active.question_id != question_id:
            return None
        hand = self._active
        self._active = None
        self._active_taken = False
        return hand

    def add_follow_up(self, hand: HandRaise, now: float) -> bool:
        """Offer a follow-up question. Returns True if it was raised.

        A follow-up goes up straight away when the floor is free (it responds
        to the answer just given, so the rate limit does not apply), otherwise
        it joins the Q&A pool.
        """
        if self._active is None:
            self._active = hand
            self._active_taken = False
            self._raised_at = now
            return True
        self._qa_pool.append(hand)
        return False

    # --- Q&A phase --------------------------------------------------------

    def next_qa(self, now: float) -> HandRaise | None:
        """Pick the next question to ask in the Q&A phase and mark it asked.

        A raised follow-up goes first and does not count toward
        ``qa_max_questions``. Otherwise the best-ranked pooled question is
        asked until the pool is empty or the limit is reached.
        """
        if self._active is not None and not self._active_taken:
            hand = self._active
            self._mark_called(hand, now)
            return hand
        if self._active_taken:
            raise ValueError(
                f"question {self._active.question_id} is still being answered"
            )
        if not self._qa_pool or self._qa_asked >= self._config.qa_max_questions:
            return None
        hand = self._select(self._qa_pool)
        self._qa_pool.remove(hand)
        self._qa_asked += 1
        self._mark_called(hand, now)
        return hand
