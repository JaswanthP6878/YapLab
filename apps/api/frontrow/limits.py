"""Single-process admission quotas for the public demo.

Reservations are synchronous (no await), so concurrent async requests cannot
oversubscribe a quota. UTC days control the shared budget; monotonic time
controls rolling visitor windows. No external service or credentials are used.
"""
from __future__ import annotations

import ipaddress
import math
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time as datetime_time, timedelta, timezone


class LimitExceeded(Exception):
    status_code = 429

    def __init__(self, message: str, retry_after: int) -> None:
        super().__init__(message)
        self.message = message
        self.retry_after = max(1, math.ceil(retry_after))


def client_ip(peer: str | None, forwarded: str | None = None) -> str:
    """Trust Caddy's first forwarded address only for the exact loopback peer."""
    direct = peer or "unknown"
    if direct == "127.0.0.1" and forwarded:
        first = forwarded.split(",", 1)[0].strip()
        try:
            # Scope identifiers are local routing metadata, not public client IDs.
            if "%" not in first:
                return str(ipaddress.ip_address(first))
        except ValueError:
            pass
    try:
        return str(ipaddress.ip_address(direct))
    except ValueError:
        return direct


@dataclass
class Reservation:
    _limits: "DemoLimits"
    _ip: str
    _id: int
    _day: date
    _pending: bool = True

    def commit(self) -> None:
        self._pending = False

    def rollback(self) -> None:
        if self._pending:
            self._limits._rollback(self._ip, self._id, self._day)
            self._pending = False


class DemoLimits:
    def __init__(self, *, sessions_per_ip_per_hour: int = 6,
                 max_sessions_per_day: int = 150,
                 monotonic: Callable[[], float] = time.monotonic,
                 utc_now: Callable[[], datetime] | None = None) -> None:
        if isinstance(sessions_per_ip_per_hour, bool) or not isinstance(sessions_per_ip_per_hour, int) or sessions_per_ip_per_hour <= 0:
            raise ValueError("sessions_per_ip_per_hour must be positive")
        if isinstance(max_sessions_per_day, bool) or not isinstance(max_sessions_per_day, int) or max_sessions_per_day <= 0:
            raise ValueError("max_sessions_per_day must be positive")
        self.sessions_per_ip_per_hour = sessions_per_ip_per_hour
        self.max_sessions_per_day = max_sessions_per_day
        self._monotonic = monotonic
        self._utc_now = utc_now or (lambda: datetime.now(timezone.utc))
        self._visitors: dict[str, deque[tuple[int, float]]] = {}
        self._day: date | None = None
        self._daily_count = 0
        self._next_id = 0

    def _now_utc(self) -> datetime:
        value = self._utc_now()
        if value.tzinfo is None:
            raise ValueError("utc_now must return a timezone-aware datetime")
        return value.astimezone(timezone.utc)

    def _refresh(self) -> tuple[float, datetime]:
        now = self._monotonic()
        wall = self._now_utc()
        if self._day != wall.date():
            self._day, self._daily_count = wall.date(), 0
        # Drop empty visitor buckets on every admission check so old IPs do not
        # accumulate over the seven-week judging window.
        for address, entries in list(self._visitors.items()):
            while entries and entries[0][1] + 3600 <= now:
                entries.popleft()
            if not entries:
                del self._visitors[address]
        return now, wall

    def check_session(self, address: str) -> None:
        now, wall = self._refresh()
        if self._daily_count >= self.max_sessions_per_day:
            tomorrow = datetime.combine(wall.date() + timedelta(days=1), datetime_time(), timezone.utc)
            raise LimitExceeded("The practice room has reached its daily limit. Please try again after midnight UTC.",
                                math.ceil((tomorrow - wall).total_seconds()))
        entries = self._visitors.get(address)
        if entries and len(entries) >= self.sessions_per_ip_per_hour:
            raise LimitExceeded("You've reached the practice-session limit for this hour. Please try again later.",
                                math.ceil(entries[0][1] + 3600 - now))

    def reserve_session(self, address: str) -> Reservation:
        self.check_session(address)
        now = self._monotonic()
        self._next_id += 1
        self._visitors.setdefault(address, deque()).append((self._next_id, now))
        self._daily_count += 1
        assert self._day is not None
        return Reservation(self, address, self._next_id, self._day)

    def _rollback(self, address: str, reservation_id: int, day: date) -> None:
        entries = self._visitors.get(address)
        if entries is not None:
            remaining = deque(entry for entry in entries if entry[0] != reservation_id)
            if remaining:
                self._visitors[address] = remaining
            else:
                self._visitors.pop(address, None)
        # A late failure from yesterday must not refund today's budget.
        if day == self._day:
            self._daily_count = max(0, self._daily_count - 1)
