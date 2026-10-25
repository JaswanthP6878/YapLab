"""Deterministic public-demo admission and lifecycle checks; no provider calls."""

from __future__ import annotations

import asyncio
import gc
import importlib
import io
import os
import signal
import threading
import weakref
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from unittest.mock import patch

from frontrow.clock import SimulatedClock
from frontrow.config import Config
from frontrow.limits import DemoLimits, LimitExceeded, client_ip
from frontrow.llm.fake import FakeLLM
from frontrow.speech import NoTTS, SpeechAudio, STTToken


class ManualClock:
    """Maintenance runs only when a check explicitly requests a sweep."""
    def __init__(self, start=0): self.value = start
    def now(self): return self.value
    def advance(self, seconds): self.value += seconds
    async def sleep(self, seconds): await asyncio.Future()


class WallClock:
    def __init__(self): self.value = datetime(2026, 10, 25, 23, 59, 30, tzinfo=timezone.utc)
    def now(self): return self.value
    def advance(self, seconds): self.value += timedelta(seconds=seconds)


def _limited(call, *, retry=None):
    try:
        call()
    except LimitExceeded as exc:
        assert exc.status_code == 429 and exc.retry_after >= 1 and exc.message
        if retry is not None: assert exc.retry_after == retry, (exc.retry_after, retry)
        return exc
    raise AssertionError("expected an admission limit")


def _server():
    with patch.dict(os.environ, {"FRONTROW_LLM": "fake", "FRONTROW_TTS": "none", "FRONTROW_STT": "none"}, clear=True):
        return importlib.import_module("frontrow.server")


class Tokens:
    def __init__(self): self.calls = self.closed = 0
    async def create_token(self, session_id):
        self.calls += 1
        return STTToken(token=f"offline-token-{self.calls}", provider="offline")
    async def aclose(self): self.closed += 1


def _app(*, clock=None, limits=None, tokens=None, llm_factory=FakeLLM, **config):
    return _server().create_app(config=Config(tick_interval_seconds=300, **config),
        llm_factory=llm_factory, tts=NoTTS(), stt_tokens=tokens or Tokens(),
        clock_factory=SimulatedClock, lifecycle_clock=clock or ManualClock(), limits=limits)


@contextmanager
def _client(app, peer="127.0.0.1"):
    from fastapi.testclient import TestClient
    signal.alarm(15)
    try:
        with TestClient(app, client=(peer, 50123)) as client: yield client
    finally:
        signal.alarm(0)


@lru_cache(maxsize=1)
def _pdf():
    from pypdf import PdfWriter
    out = io.BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    writer.write(out)
    return out.getvalue()


def _create(client, *, pdf=False, headers=None):
    if pdf:
        return client.post("/sessions/upload", files={"file": ("offline.pdf", _pdf(), "application/pdf")}, headers=headers)
    return client.post("/sessions", json={"slides": [{"index": 0, "text": "Replication and quorum"}]}, headers=headers)


def _sweep(client, app):
    client.portal.call(app.state.sweep_sessions)


async def _yield():
    await asyncio.sleep(0)


def _request(ws, kind, ident, **fields):
    ws.send_json({"type": kind, "id": ident, **fields})
    while True:
        message = ws.receive_json()
        if message.get("id") == ident:
            assert message["type"] == "ack", message
            return message["result"]


def check_demo_rolling_hour_and_reservation_refunds() -> None:
    clock, wall = ManualClock(), WallClock()
    limits = DemoLimits(monotonic=clock.now, utc_now=wall.now)
    for index in range(6):
        clock.value = index * 100
        limits.reserve_session("visitor").commit()
    clock.value = 3599
    _limited(lambda: limits.check_session("visitor"), retry=1)
    clock.value = 3600
    limits.reserve_session("visitor").commit()
    _limited(lambda: limits.check_session("visitor"), retry=100)
    clock.value = 3700
    limits.check_session("visitor")

    small = DemoLimits(sessions_per_ip_per_hour=2, monotonic=clock.now, utc_now=wall.now)
    for _ in range(10): small.check_session("visitor")  # Checks do not consume slots.
    pending = small.reserve_session("visitor")
    committed = small.reserve_session("visitor")
    committed.commit()
    _limited(lambda: small.check_session("visitor"))
    pending.rollback()
    pending.rollback()
    small.reserve_session("visitor").commit()
    committed.rollback()  # Committed admissions cannot be refunded.
    _limited(lambda: small.check_session("visitor"))


def check_demo_daily_budget_utc_reset_and_late_refund() -> None:
    clock, wall = ManualClock(), WallClock()
    limits = DemoLimits(monotonic=clock.now, utc_now=wall.now)
    for index in range(150): limits.reserve_session(f"visitor-{index}").commit()
    _limited(lambda: limits.check_session("new-visitor"), retry=30)
    wall.advance(29.5)
    _limited(lambda: limits.check_session("new-visitor"), retry=1)
    wall.advance(.5)
    limits.reserve_session("new-visitor").commit()

    wall = WallClock()
    one = DemoLimits(max_sessions_per_day=1, monotonic=clock.now, utc_now=wall.now)
    yesterday = one.reserve_session("yesterday")
    wall.advance(30)
    one.reserve_session("today").commit()
    yesterday.rollback()
    _limited(lambda: one.check_session("another-today"))


def check_demo_proxy_trust_and_config_defaults() -> None:
    assert client_ip("127.0.0.1", " 198.51.100.7, 10.0.0.2") == "198.51.100.7"
    assert client_ip("127.0.0.1", "2001:0db8::0001, 10.0.0.2") == "2001:db8::1"
    for peer in ("198.51.100.8", "::1", "127.0.0.2"):
        assert client_ip(peer, "203.0.113.4") == peer
    for forwarded in ("not-an-ip, 198.51.100.7", "fe80::1%en0", ""):
        assert client_ip("127.0.0.1", forwarded) == "127.0.0.1"
    cfg = Config()
    expected = {"idle_end_seconds": 60, "max_session_seconds": 1200,
        "session_retention_seconds": 3600, "max_live_sessions": 20,
        "sessions_per_ip_per_hour": 6, "stt_tokens_per_session": 10, "max_sessions_per_day": 150}
    for field, value in expected.items(): assert getattr(cfg, field) == value, field
    for field in ("idle_end_seconds", "max_session_seconds", "session_retention_seconds"):
        for invalid in (-1, float("inf"), float("nan")):
            try: Config(**{field: invalid})
            except ValueError: pass
            else: raise AssertionError(f"invalid lifecycle duration accepted: {field}={invalid}")
    for field in ("idle_end_seconds", "max_session_seconds", "max_live_sessions", "sessions_per_ip_per_hour", "stt_tokens_per_session", "max_sessions_per_day"):
        try: Config(**{field: 0})
        except ValueError: pass
        else: raise AssertionError(f"zero policy limit accepted: {field}")
    assert Config(session_retention_seconds=0).session_retention_seconds == 0
    with patch.dict(os.environ, {"FRONTROW_IDLE_END_SECONDS": "12.5", "FRONTROW_MAX_SESSION_SECONDS": "100",
            "FRONTROW_SESSION_RETENTION_SECONDS": "0", "FRONTROW_MAX_LIVE_SESSIONS": "3",
            "FRONTROW_SESSIONS_PER_IP_PER_HOUR": "4", "FRONTROW_STT_TOKENS_PER_SESSION": "5",
            "FRONTROW_MAX_SESSIONS_PER_DAY": "6"}, clear=True):
        configured = Config.from_env()
        for field, value in {"idle_end_seconds": 12.5, "max_session_seconds": 100,
                "session_retention_seconds": 0, "max_live_sessions": 3,
                "sessions_per_ip_per_hour": 4, "stt_tokens_per_session": 5, "max_sessions_per_day": 6}.items():
            assert getattr(configured, field) == value, field


def check_demo_http_quotas_apply_to_json_and_pdf_and_proxy_peers() -> None:
    clock, wall = ManualClock(), WallClock()
    limits = DemoLimits(monotonic=clock.now, utc_now=wall.now)
    app = _app(clock=clock, limits=limits)
    with _client(app) as client:
        for index in range(6):
            assert _create(client, pdf=bool(index % 2), headers={"X-Forwarded-For": "198.51.100.1"}).status_code == 201
        for pdf in (False, True):
            rejected = _create(client, pdf=pdf, headers={"X-Forwarded-For": "198.51.100.1"})
            assert rejected.status_code == 429 and int(rejected.headers["Retry-After"]) == 3600, rejected.text
            assert rejected.json()["detail"]
        assert _create(client, headers={"X-Forwarded-For": "198.51.100.2"}).status_code == 201
    for peer in ("203.0.113.7", "::1"):
        app = _app(clock=ManualClock())
        with _client(app, peer) as client:
            for index in range(6):
                assert _create(client, headers={"X-Forwarded-For": f"198.51.100.{index}"}).status_code == 201
            rejected = _create(client, headers={"X-Forwarded-For": "198.51.100.99"})
            assert rejected.status_code == 429, "untrusted peers must not rotate spoofed headers around a quota"


def check_demo_stt_concurrent_cap_precedes_provider_calls() -> None:
    from httpx import ASGITransport, AsyncClient
    class BlockingTokens(Tokens):
        def __init__(self):
            super().__init__()
            self.ten_started = asyncio.Event()
            self.release = asyncio.Event()
        async def create_token(self, session_id):
            self.calls += 1
            if self.calls >= 10: self.ten_started.set()
            await self.release.wait()
            return STTToken(token="offline-concurrent-token", provider="offline")
    async def run():
        tokens = BlockingTokens()
        app = _app(tokens=tokens)
        async with app.router.lifespan_context(app), AsyncClient(transport=ASGITransport(app), base_url="http://offline") as client:
            sid = (await client.post("/sessions", json={})).json()["id"]
            tasks = [asyncio.create_task(client.post(f"/sessions/{sid}/stt-token")) for _ in range(20)]
            try:
                await asyncio.wait_for(tokens.ten_started.wait(), 1)
                for _ in range(5): await asyncio.sleep(0)
                assert tokens.calls == 10, "the token slot must be reserved before awaiting the provider"
            finally:
                tokens.release.set()
                responses = await asyncio.gather(*tasks)
            assert sorted(response.status_code for response in responses) == [200] * 10 + [429] * 10
            for response in responses:
                if response.status_code == 429:
                    assert int(response.headers["Retry-After"]) >= 1 and response.json()["detail"]
        assert tokens.closed == 1
        class FailingTokens(Tokens):
            async def create_token(self, session_id):
                self.calls += 1
                raise RuntimeError("offline uncertain token issuance")
        tokens = FailingTokens()
        app = _app(tokens=tokens)
        async with app.router.lifespan_context(app), AsyncClient(transport=ASGITransport(app), base_url="http://offline") as client:
            sid = (await client.post("/sessions", json={})).json()["id"]
            for _ in range(10):
                assert (await client.post(f"/sessions/{sid}/stt-token")).status_code == 502
            assert (await client.post(f"/sessions/{sid}/stt-token")).status_code == 429
            assert tokens.calls == 10, "failed/uncertain provider attempts still consume their slots"
    asyncio.run(run())


def check_demo_live_cap_includes_idle_json_and_pdf_rooms() -> None:
    app = _app(sessions_per_ip_per_hour=100, max_sessions_per_day=1000)
    with _client(app) as client:
        for index in range(20):
            response = _create(client, pdf=bool(index % 2))
            assert response.status_code == 201 and response.json()["state"] == "idle", response.text
        for pdf in (False, True):
            response = _create(client, pdf=pdf)
            assert response.status_code == 503 and response.json()["detail"], response.text
        health = client.get("/health").json()
        assert health["live_sessions"] == 20 and health["retained_sessions"] == 0, health


def check_demo_idle_unstarted_and_disconnected_rooms_end_with_report() -> None:
    for started in (False, True):
        clock = ManualClock()
        app = _app(clock=clock)
        with _client(app) as client:
            sid = _create(client).json()["id"]
            if started:
                with client.websocket_connect(f"/sessions/{sid}/ws") as ws:
                    assert ws.receive_json()["type"] == "hello"
                    _request(ws, "start", 1)
                    _request(ws, "transcript", 2, seq=0, text="Replication keeps the lesson available.", duration=1)
                client.portal.call(_yield)
            clock.advance(59.999)
            _sweep(client, app)
            assert client.get(f"/sessions/{sid}").json()["state"] == ("presenting" if started else "idle")
            clock.advance(.001)
            _sweep(client, app)
            assert client.get(f"/sessions/{sid}").json()["state"] == "ended"
            report = client.get(f"/sessions/{sid}/report")
            assert report.status_code == 200 and report.json()["session_id"] == sid
            assert report.json()["delivery"]["words"] > 0 if started else report.json()["delivery"]["words"] == 0


def check_demo_reconnect_and_other_clients_cancel_disconnect_grace() -> None:
    clock = ManualClock()
    app = _app(clock=clock)
    with _client(app) as client:
        sid = _create(client).json()["id"]
        with client.websocket_connect(f"/sessions/{sid}/ws") as first:
            first.receive_json()
            _request(first, "start", 1)
        client.portal.call(_yield)
        clock.advance(59)
        with client.websocket_connect(f"/sessions/{sid}/ws") as second:
            second.receive_json()
            clock.advance(2)
            _sweep(client, app)
            assert client.get(f"/sessions/{sid}").json()["state"] == "presenting"
            with client.websocket_connect(f"/sessions/{sid}/ws") as third:
                third.receive_json()
            client.portal.call(_yield)
            clock.advance(100)
            _sweep(client, app)
            assert client.get(f"/sessions/{sid}").json()["state"] == "presenting", "one remaining client keeps the room connected"
        client.portal.call(_yield)
        clock.advance(59.999)
        _sweep(client, app)
        assert client.get(f"/sessions/{sid}").json()["state"] == "presenting"
        clock.advance(.001)
        _sweep(client, app)
        assert client.get(f"/sessions/{sid}").json()["state"] == "ended"


def check_demo_maximum_age_ends_connected_room_and_preserves_report() -> None:
    for started in (False, True):
        clock = ManualClock()
        app = _app(clock=clock)
        with _client(app) as client:
            sid = _create(client).json()["id"]
            with client.websocket_connect(f"/sessions/{sid}/ws") as ws:
                ws.receive_json()
                if started:
                    _request(ws, "start", 1)
                    _request(ws, "transcript", 2, seq=0, text="A quorum is a majority of replicas.", duration=1)
                clock.advance(1199.999)
                _sweep(client, app)
                assert client.get(f"/sessions/{sid}").json()["state"] == ("presenting" if started else "idle")
                clock.advance(.001)
                _sweep(client, app)
                assert client.get(f"/sessions/{sid}").json()["state"] == "ended"
                report = client.get(f"/sessions/{sid}/report")
                assert report.status_code == 200
                if started: assert report.json()["delivery"]["words"] == 7


def check_demo_http_daily_limit_retry_after_and_midnight_reset() -> None:
    clock, wall = ManualClock(), WallClock()
    limits = DemoLimits(max_sessions_per_day=1, monotonic=clock.now, utc_now=wall.now)
    app = _app(clock=clock, limits=limits)
    with _client(app) as client:
        assert _create(client).status_code == 201
        for pdf in (False, True):
            response = _create(client, pdf=pdf)
            assert response.status_code == 429 and int(response.headers["Retry-After"]) == 30
            assert "UTC" in response.json()["detail"]
        wall.advance(30)
        assert _create(client).status_code == 201


def check_demo_retention_evicts_payloads_and_closes_room_resources_once() -> None:
    class ClosingFake(FakeLLM):
        def __init__(self): self.closed = 0
        async def aclose(self): self.closed += 1
    resources = []
    def factory():
        llm = ClosingFake()
        resources.append(llm)
        return llm
    clock = ManualClock()
    app = _app(clock=clock, llm_factory=factory)
    with _client(app) as client:
        sid = _create(client).json()["id"]
        live = app.state.sessions[sid]
        reference = weakref.ref(live)
        live.audio["cached-question"] = SpeechAudio(data=b"ID3offline-cache", content_type="audio/mpeg")
        with client.websocket_connect(f"/sessions/{sid}/ws") as ws:
            ws.receive_json()
            _request(ws, "start", 1)
            _request(ws, "transcript", 2, seq=0, text="This presenter transcript must not remain after eviction.")
            _request(ws, "end_presenting", 3)
            _request(ws, "end_qa", 4)
            _request(ws, "finish", 5)
        client.portal.call(_yield)
        _sweep(client, app)
        assert client.get("/health").json()["retained_sessions"] == 1
        clock.advance(3599.999)
        _sweep(client, app)
        assert client.get(f"/sessions/{sid}/audio/cached-question").status_code == 200
        clock.advance(.001)
        _sweep(client, app)
        assert sid not in app.state.sessions
        for path in (f"/sessions/{sid}", f"/sessions/{sid}/report", f"/sessions/{sid}/events", f"/sessions/{sid}/audio/cached-question"):
            assert client.get(path).status_code == 404, path
        assert resources[1].closed == 1
        assert not live.clients and all(task.done() for task in live.tasks)
        del live
        del ws
        gc.collect()
        assert reference() is None, "eviction must release the transcript/audio-bearing live object"
    assert all(llm.closed == 1 for llm in resources), "app shutdown must not close an evicted SDK twice"


def check_demo_auto_end_cancels_inflight_calls_without_new_inference() -> None:
    class SlowFake(FakeLLM):
        def __init__(self):
            self.calls = self.active = self.closed = 0
            self.started = asyncio.Event()
        async def complete(self, system, user, *, model, timeout):
            self.calls += 1
            self.active += 1
            self.started.set()
            try: await asyncio.Future()
            finally: self.active -= 1
        async def aclose(self):
            assert self.active == 0
            self.closed += 1
    slow = SlowFake()
    clock = ManualClock()
    app = _app(clock=clock, llm_factory=lambda: slow)
    with _client(app) as client:
        sid = _create(client).json()["id"]
        session = app.state.sessions[sid].session
        async def begin_tick():
            session.start()
            task = asyncio.create_task(session.orchestrator.run_tick())
            await asyncio.wait_for(slow.started.wait(), 1)
            for _ in range(5): await asyncio.sleep(0)
            return task
        tick = client.portal.call(begin_tick)
        assert slow.calls == slow.active == 5
        clock.advance(60)
        async def bounded_sweep(): await asyncio.wait_for(app.state.sweep_sessions(), 1)
        client.portal.call(bounded_sweep)
        assert tick.done() and slow.active == 0
        assert client.get(f"/sessions/{sid}").json()["state"] == "ended"
        assert client.get(f"/sessions/{sid}/report").status_code == 200
        clock.advance(1000)
        _sweep(client, app)
        assert slow.calls == 5, "cleanup must not schedule closing reactions, summaries, or answer judges"
    assert slow.closed == 1, "a shared validation/room SDK closes once at app shutdown"


def check_demo_deadline_preempts_a_command_holding_the_session_lock() -> None:
    server = _server()
    original_end = server.Session.end_presenting
    class SlowFake(FakeLLM):
        def __init__(self):
            self.calls = self.active = 0
            self.started = asyncio.Event()
        async def complete(self, system, user, *, model, timeout):
            self.calls += 1
            self.active += 1
            self.started.set()
            try: await asyncio.Future()
            finally: self.active -= 1
    slow = SlowFake()
    clock = ManualClock()
    command_entered = asyncio.Event()
    async def waiting_end(session):
        command_entered.set()
        return await original_end(session)
    app = _app(clock=clock, llm_factory=lambda: slow)
    with patch.object(server.Session, "end_presenting", waiting_end), _client(app) as client:
        sid = _create(client).json()["id"]
        live = app.state.sessions[sid]
        with client.websocket_connect(f"/sessions/{sid}/ws") as ws:
            ws.receive_json()
            _request(ws, "start", 1)
            async def begin_tick():
                task = asyncio.create_task(live.session.orchestrator.run_tick())
                await asyncio.wait_for(slow.started.wait(), 1)
                for _ in range(5): await asyncio.sleep(0)
                return task
            tick = client.portal.call(begin_tick)
            ws.send_json({"type": "end_presenting", "id": 2})
            async def wait_command(): await asyncio.wait_for(command_entered.wait(), 1)
            client.portal.call(wait_command)
            assert live.lock.locked() and slow.active == 5
            clock.advance(1200)
            async def bounded_sweep(): await asyncio.wait_for(app.state.sweep_sessions(), 1)
            client.portal.call(bounded_sweep)
            assert client.get(f"/sessions/{sid}").json()["state"] == "ended"
            assert client.get(f"/sessions/{sid}/report").status_code == 200
            assert tick.done() and slow.active == 0 and slow.calls == 5


def check_demo_cancelled_upload_holds_extraction_slot_but_refunds_admission() -> None:
    from httpx import ASGITransport, AsyncClient
    from frontrow.models import Slide
    server = _server()
    first_started = threading.Event()
    first_release = threading.Event()
    second_started = threading.Event()
    count_lock = threading.Lock()
    calls = 0
    def blocked_extract(data):
        nonlocal calls
        with count_lock:
            calls += 1
            number = calls
        if number == 1:
            first_started.set()
            assert first_release.wait(5), "test must always release its extraction thread"
        else:
            second_started.set()
        return [Slide(index=0, text="An offline uploaded slide")]
    class ObservedLimits(DemoLimits):
        reservations = 0
        def reserve_session(self, address):
            ticket = super().reserve_session(address)
            self.reservations += 1
            return ticket
    async def run():
        clock, wall = ManualClock(), WallClock()
        limits = ObservedLimits(sessions_per_ip_per_hour=2, max_sessions_per_day=2,
            monotonic=clock.now, utc_now=wall.now)
        app = _app(clock=clock, limits=limits, max_live_sessions=2)
        async with app.router.lifespan_context(app), AsyncClient(transport=ASGITransport(app), base_url="http://offline") as client:
            original = await client.post("/sessions", json={})
            assert original.status_code == 201
            original_id = original.json()["id"]
            first = asyncio.create_task(client.post("/sessions/upload", files={"file": ("one.pdf", _pdf(), "application/pdf")}))
            second = None
            try:
                assert await asyncio.to_thread(first_started.wait, 1), "the first extractor must run in a thread"
                assert (await asyncio.wait_for(client.get("/health"), 1)).status_code == 200
                first.cancel()
                try: await first
                except asyncio.CancelledError: pass
                else: raise AssertionError("the upload request should remain cancelled")

                second = asyncio.create_task(client.post("/sessions/upload", files={"file": ("two.pdf", _pdf(), "application/pdf")}))
                async def wait_for_reservation():
                    while limits.reservations < 3 and not second.done(): await asyncio.sleep(0)
                await asyncio.wait_for(wait_for_reservation(), 1)
                assert limits.reservations == 3 and not second.done(), "cancellation must refund both quota and pending live capacity"
                for _ in range(10): await asyncio.sleep(0)
                assert calls == 1 and not second_started.is_set(), "a cancelled caller cannot release a still-running extractor's permit"

                # The blocked extraction must not prevent maintenance or health.
                clock.advance(60)
                await asyncio.wait_for(app.state.sweep_sessions(), 1)
                assert (await asyncio.wait_for(client.get("/health"), 1)).json()["live_sessions"] == 0
                assert (await client.get(f"/sessions/{original_id}/report")).status_code == 200
                assert not second_started.is_set()
                first_release.set()
                response = await asyncio.wait_for(second, 1)
                assert response.status_code == 201 and second_started.is_set() and calls == 2, response.text
                assert len(app.state.sessions) == 2, "the cancelled extraction must not create a room later"
                assert (await client.post("/sessions", json={})).status_code == 429, "refund only the cancelled reservation"
            finally:
                first_release.set()
                await asyncio.gather(first, *([second] if second is not None else []), return_exceptions=True)
    with patch.object(server, "extract_slides", blocked_extract): asyncio.run(run())


def check_demo_sdk_close_survives_cancelled_cleanup_during_shutdown() -> None:
    from httpx import ASGITransport, AsyncClient
    class GatedClose(FakeLLM):
        def __init__(self, gated):
            self.gated = gated
            self.started = asyncio.Event()
            self.release = asyncio.Event()
            self.close_calls = self.cancelled = 0
            self.fully_closed = False
        async def aclose(self):
            self.close_calls += 1
            self.started.set()
            if self.gated:
                try: await self.release.wait()
                except asyncio.CancelledError:
                    self.cancelled += 1
                    raise
            self.fully_closed = True
    async def run():
        resources = []
        def factory():
            resource = GatedClose(gated=bool(resources))
            resources.append(resource)
            return resource
        clock = SimulatedClock()
        app = _app(clock=clock, llm_factory=factory)
        lifespan = app.router.lifespan_context(app)
        await lifespan.__aenter__()
        shutdown = None
        try:
            async with AsyncClient(transport=ASGITransport(app), base_url="http://offline") as client:
                sid = (await client.post("/sessions", json={})).json()["id"]
            await asyncio.sleep(0)  # Register the maintenance clock's first sleep.
            await clock.advance(60)
            room = resources[1]
            await asyncio.wait_for(room.started.wait(), 1)
            live = app.state.sessions[sid]
            cleanup = live.cleanup_task
            assert cleanup is not None and not cleanup.done()
            shutdown = asyncio.create_task(lifespan.__aexit__(None, None, None))
            async def wait_for_cleanup_cancellation():
                while not cleanup.done(): await asyncio.sleep(0)
            await asyncio.wait_for(wait_for_cleanup_cancellation(), 1)
            assert cleanup.cancelled(), "shutdown must interrupt the idle cleanup job"
            assert not shutdown.done() and room.cancelled == 0 and not room.fully_closed
            room.release.set()
            await asyncio.wait_for(shutdown, 1)
            assert live.closed and live.resource_released
            assert all(resource.close_calls == 1 and resource.cancelled == 0 and resource.fully_closed for resource in resources)
            assert app.state.maintenance_task.done()
        finally:
            for resource in resources: resource.release.set()
            if shutdown is None:
                await lifespan.__aexit__(None, None, None)
            else:
                await asyncio.gather(shutdown, return_exceptions=True)
    asyncio.run(run())


def check_demo_cutoff_cancels_summary_from_direct_closing_tick() -> None:
    from httpx import ASGITransport, AsyncClient
    from frontrow.llm.fake import SUMMARY_MARKER
    class SlowSummary(FakeLLM):
        def __init__(self):
            self.started = asyncio.Event()
            self.cancelled = False
            self.calls = 0
        async def complete(self, system, user, *, model, timeout):
            self.calls += 1
            if SUMMARY_MARKER in system + user:
                self.started.set()
                try: await asyncio.Future()
                except asyncio.CancelledError:
                    self.cancelled = True
                    raise
            return await super().complete(system, user, model=model, timeout=timeout)
    async def run():
        llm = SlowSummary()
        clock = ManualClock()
        app = _server().create_app(config=Config(tick_interval_seconds=300),
            llm_factory=lambda: llm, tts=NoTTS(), stt_tokens=Tokens(),
            lifecycle_clock=clock, clock_factory=lambda: SimulatedClock(start=1))
        async with app.router.lifespan_context(app), AsyncClient(transport=ASGITransport(app), base_url="http://offline") as client:
            sid = (await client.post("/sessions", json={})).json()["id"]
            live = app.state.sessions[sid]
            live.session.start()
            live.session.ingest_transcript(0, "The gradient points toward the steepest increase of the loss function.")
            async def manual_end_command():
                async with live.lock:
                    await live.session.end_presenting()
            command = asyncio.create_task(manual_end_command())
            try:
                await asyncio.wait_for(llm.started.wait(), 1)
                assert live.lock.locked() and live.session.orchestrator._inflight_tick is None
                assert llm.calls == 6  # Five completed reactions and the blocked summary.
                clock.advance(1200)
                await asyncio.wait_for(app.state.sweep_sessions(), 1)
                assert live.session.state.value == "ended" and llm.cancelled
                assert command.done() and llm.calls == 6
                assert (await client.get(f"/sessions/{sid}/report")).status_code == 200
            finally:
                command.cancel()
                await asyncio.gather(command, return_exceptions=True)
    asyncio.run(run())


DEMO_HARDENING_CHECKS = [
    ("demo: rolling-hour quota + pending-only reservation refunds", check_demo_rolling_hour_and_reservation_refunds),
    ("demo: 150-session UTC budget resets + late refunds stay isolated", check_demo_daily_budget_utc_reset_and_late_refund),
    ("demo: exact-loopback proxy trust + finite lifecycle defaults", check_demo_proxy_trust_and_config_defaults),
    ("demo: JSON/PDF quotas + untrusted forwarded addresses", check_demo_http_quotas_apply_to_json_and_pdf_and_proxy_peers),
    ("demo: concurrent STT requests reserve ten slots before providers", check_demo_stt_concurrent_cap_precedes_provider_calls),
    ("demo: twenty-live cap includes idle JSON/PDF rooms", check_demo_live_cap_includes_idle_json_and_pdf_rooms),
    ("demo: unstarted and disconnected rooms end at sixty seconds", check_demo_idle_unstarted_and_disconnected_rooms_end_with_report),
    ("demo: reconnect and another client prevent premature idle end", check_demo_reconnect_and_other_clients_cancel_disconnect_grace),
    ("demo: connected rooms end at twenty minutes with normal reports", check_demo_maximum_age_ends_connected_room_and_preserves_report),
    ("demo: HTTP daily quota exposes UTC Retry-After and resets", check_demo_http_daily_limit_retry_after_and_midnight_reset),
    ("demo: one-hour eviction releases retained data and room SDKs", check_demo_retention_evicts_payloads_and_closes_room_resources_once),
    ("demo: orphan cleanup cancels in-flight calls without new inference", check_demo_auto_end_cancels_inflight_calls_without_new_inference),
    ("demo: maximum age preempts commands blocked on inference", check_demo_deadline_preempts_a_command_holding_the_session_lock),
    ("demo: cancelled upload retains one extractor and refunds admission", check_demo_cancelled_upload_holds_extraction_slot_but_refunds_admission),
    ("demo: SDK close finishes once when shutdown interrupts cleanup", check_demo_sdk_close_survives_cancelled_cleanup_during_shutdown),
    ("demo: cutoff cancels the summary of a direct closing tick", check_demo_cutoff_cancels_summary_from_direct_closing_tick),
]
