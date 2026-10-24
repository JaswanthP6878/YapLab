"""Clock abstraction for deterministic replay and tests.

The orchestration core reads time and sleeps exclusively through a ``Clock``
so that a ``SimulatedClock`` can drive the tick loop deterministically in
tests, while ``RealClock`` is used in production.
"""

from __future__ import annotations

import asyncio
import heapq
import time
from typing import Protocol, runtime_checkable


@runtime_checkable
class Clock(Protocol):
    """A source of time and asynchronous sleeping."""

    def now(self) -> float:
        """Return the current time in seconds (monotonic, not wall clock)."""
        ...

    async def sleep(self, seconds: float) -> None:
        """Sleep for ``seconds`` as measured by this clock."""
        ...


class RealClock:
    """A clock backed by the monotonic clock and ``asyncio.sleep``.

    Time is reported relative to construction, so ``now()`` starts near 0 at
    session start and lines up with session-relative transcript chunk times.
    """

    def __init__(self) -> None:
        self._t0 = time.monotonic()

    def now(self) -> float:
        return time.monotonic() - self._t0

    async def sleep(self, seconds: float) -> None:
        if seconds > 0:
            await asyncio.sleep(seconds)


class SimulatedClock:
    """A deterministic virtual clock.

    Time only advances in response to :meth:`advance`. Sleepers register a
    deadline and their future is resolved, in deadline order, as time passes
    the deadline. This makes the tick loop fully deterministic in tests.
    """

    def __init__(self, start: float = 0.0) -> None:
        self._now: float = start
        # Min-heap of (deadline, seq, future) so wakeups are ordered.
        self._waiters: list[tuple[float, int, asyncio.Future[None]]] = []
        self._seq: int = 0

    def now(self) -> float:
        return self._now

    async def sleep(self, seconds: float) -> None:
        if seconds < 0:
            raise ValueError("cannot sleep for a negative duration")
        if seconds == 0:
            # Yield control without registering a waiter.
            await asyncio.sleep(0)
            return
        loop = asyncio.get_event_loop()
        fut: asyncio.Future[None] = loop.create_future()
        deadline = self._now + seconds
        heapq.heappush(self._waiters, (deadline, self._seq, fut))
        self._seq += 1
        await fut

    async def advance(self, seconds: float) -> None:
        """Advance virtual time by ``seconds``, waking due sleepers in order.

        Waiters whose deadline is reached are resolved one at a time with a
        yield between each so their coroutines can run and register new
        sleeps, keeping ordering deterministic.
        """
        if seconds < 0:
            raise ValueError("time cannot move backward")
        target = self._now + seconds
        while self._waiters and self._waiters[0][0] <= target:
            deadline, _seq, fut = heapq.heappop(self._waiters)
            self._now = deadline
            if not fut.done():
                fut.set_result(None)
            # Let the woken coroutine make progress (and possibly register a
            # new sleep) before we consider the next waiter.
            await asyncio.sleep(0)
        self._now = target
        # Final yield so any coroutine woken exactly at ``target`` runs.
        await asyncio.sleep(0)
