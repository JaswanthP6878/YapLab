"""FastAPI server: REST for setup, one WebSocket per session for the live loop.

    cd apps/api
    uv run uvicorn frontrow.server:app --reload

REST creates sessions (slides as text or a PDF), mints STT tokens, serves
question audio, and returns the end-of-session summary. The WebSocket at
``/sessions/{id}/ws`` carries everything live: client commands in (see
:mod:`frontrow.protocol`), acks/errors and timeline events out.

Speech engines plug in through :func:`create_app` (or
:func:`speech_engines_from_env`); see :mod:`frontrow.speech`.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from . import teaching_moves
from .clock import Clock, RealClock
from .config import Config
from .llm.base import LLMClient
from .llm.fake import FakeLLM
from .llm.fallback import FallbackLLM
from .llm.openai_client import PROVIDERS, OpenAIClient
from .limits import DemoLimits, LimitExceeded, client_ip
from .metrics import filler_count, longest_pause, speaking_rate, word_count
from .models import SessionState, Slide, TimelineEvent
from .personas import ROOM_PRESETS
from .protocol import (
    AckMessage,
    CreateSessionRequest,
    ErrorMessage,
    EventOut,
    HelloMessage,
    ListenerInfo,
    SessionInfo,
    client_message_adapter,
)
from .session import Session, SessionError
from .slides import MAX_UPLOAD_BYTES, SlideError, extract_slides
from .speech import (
    NoSTTTokens,
    NoTTS,
    SpeechAudio,
    SpeechNotConfigured,
    STTTokenProvider,
    TTSEngine,
)

# Events whose question gets synthesized to audio.
_SPOKEN_EVENTS = ("hand_raised", "qa_question")
# Per-client outbound buffer; a client this far behind is disconnected.
_CLIENT_QUEUE_MAX = 1000
_RESOURCE_CLOSE_TIMEOUT_SECONDS = 5.0

# Speech generation measurements must be visible under the normal uvicorn command.
_speech_logger = logging.getLogger("frontrow.speech_elevenlabs")
if not _speech_logger.handlers:
    _speech_logger.addHandler(logging.StreamHandler())
_speech_logger.setLevel(logging.INFO)
_speech_logger.propagate = False


def llm_from_env() -> Callable[[], LLMClient]:
    """LLM factory from ``FRONTROW_LLM`` (fake, deepseek, openai, nebius, or anthropic)."""
    kind = os.environ.get("FRONTROW_LLM", "fake").strip() or "fake"
    if kind == "fake":
        return FakeLLM
    if kind in PROVIDERS:
        return lambda: FallbackLLM(OpenAIClient(provider=kind))
    if kind == "anthropic":
        from .llm.anthropic_client import AnthropicClient

        return lambda: FallbackLLM(AnthropicClient())
    raise RuntimeError(
        f"unknown FRONTROW_LLM: {kind!r} (use fake, {', '.join(PROVIDERS)}, or anthropic)"
    )


def _speech_provider_kind(name: str) -> str:
    kind = os.environ.get(name, "none").strip() or "none"
    if kind not in {"none", "elevenlabs"}:
        raise RuntimeError(f"unknown {name}: {kind!r} (use none or elevenlabs)")
    return kind


def _tts_from_env(kind: str) -> TTSEngine:
    if kind == "none":
        return NoTTS()
    from .speech_elevenlabs import ElevenLabsTTS

    return ElevenLabsTTS()


def _stt_from_env(kind: str) -> STTTokenProvider:
    if kind == "none":
        return NoSTTTokens()
    from .speech_elevenlabs import ElevenLabsSTTTokens

    return ElevenLabsSTTTokens()


def speech_engines_from_env() -> tuple[TTSEngine, STTTokenProvider]:
    """Select both optional speech engines without changing the session protocol."""
    tts_kind = _speech_provider_kind("FRONTROW_TTS")
    stt_kind = _speech_provider_kind("FRONTROW_STT")
    return _tts_from_env(tts_kind), _stt_from_env(stt_kind)


@dataclass(eq=False)
class _Client:
    """One WebSocket connection's outbound queue."""

    queue: asyncio.Queue[dict[str, Any]] = field(
        default_factory=lambda: asyncio.Queue(maxsize=_CLIENT_QUEUE_MAX)
    )
    overflowed: bool = False
    ws: WebSocket | None = None


@dataclass(eq=False)
class _Live:
    """A session plus its server-side state."""

    session: Session
    clients: set[_Client] = field(default_factory=set)
    audio: dict[str, SpeechAudio] = field(default_factory=dict)
    tasks: set[asyncio.Task[None]] = field(default_factory=set)
    # Serializes commands from several connected clients.
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    created_at: float = 0.0
    disconnected_since: float | None = None
    ended_at: float | None = None
    closing: bool = False
    closed: bool = False
    evicted: bool = False
    stt_attempts: int = 0
    llm: LLMClient | None = None
    resource_released: bool = False
    cleanup_task: asyncio.Task | None = None


_ACTIVE_STATES = {SessionState.IDLE, SessionState.PRESENTING, SessionState.QA}


def _event_out(e: TimelineEvent) -> dict[str, Any]:
    return EventOut(event=e.type, t=e.t, data=e.data).model_dump(mode="json")


def session_info(session: Session) -> SessionInfo:
    return SessionInfo(
        id=session.id,
        state=session.state.value,
        preset=session.preset,
        current_slide=session.current_slide,
        listeners=[
            ListenerInfo(id=lid, persona=lst.persona.name)
            for lid, lst in session.listeners.items()
        ],
        slides=session.slides,
    )


def session_summary(session: Session) -> dict[str, Any]:
    """End-of-session summary (v0): room score per tick, answers, delivery."""
    events = session.events
    starts = {e.data["tick"]: e for e in events if e.type == "tick_start"}
    ticks = [
        {
            "tick": e.data["tick"],
            "t": starts[e.data["tick"]].t if e.data["tick"] in starts else e.t,
            "slide": starts[e.data["tick"]].data.get("slide") if e.data["tick"] in starts else None,
            "room": e.data.get("room"),
        }
        for e in events
        if e.type == "tick_complete"
    ]
    verdicts = [e.data for e in events if e.type == "answer_verdict"]
    talk = [c for c in session.transcript if getattr(c, "answer_to", None) is None]
    duration = talk[-1].end if talk else 0.0
    text = " ".join(c.text for c in talk)
    summary = {
        "session_id": session.id,
        "ticks": ticks,
        "questions": {
            "raised": sum(1 for e in events if e.type == "hand_raised"),
            "asked": sum(1 for e in events if e.type in ("question_taken", "qa_question")),
            "verdicts": {
                k: sum(1 for v in verdicts if v["verdict"] == k)
                for k in ("answered", "partial", "dodged")
            },
            "answers": verdicts,
        },
        "delivery": {
            "duration_seconds": round(duration, 1),
            "words": word_count(text),
            "words_per_minute": speaking_rate(talk, 0.0, duration),
            "filler_words": filler_count(text),
            "longest_pause_seconds": longest_pause(talk),
        },
    }
    moves = teaching_moves.analyze([c.text for c in session.transcript])
    if moves is not None:
        summary["teaching_moves"] = moves
    return summary


def create_app(
    *,
    config: Config | None = None,
    llm_factory: Callable[[], LLMClient] | None = None,
    tts: TTSEngine | None = None,
    stt_tokens: STTTokenProvider | None = None,
    clock_factory: Callable[[], Clock] = RealClock,
    lifecycle_clock: Clock | None = None,
    limits: DemoLimits | None = None,
) -> FastAPI:
    """Build the app. Every dependency is injectable for tests."""
    base_config = config or Config.from_env()
    make_llm = llm_factory or llm_from_env()
    validation_llm = make_llm()  # fail fast; retain ownership for shutdown
    # Explicit dependencies override provider configuration as well as instances.
    # An ignored environment provider must not require its optional SDK or key.
    tts_engine = tts if tts is not None else _tts_from_env(_speech_provider_kind("FRONTROW_TTS"))
    stt_provider = stt_tokens if stt_tokens is not None else _stt_from_env(_speech_provider_kind("FRONTROW_STT"))
    sessions: dict[str, _Live] = {}
    life_clock = lifecycle_clock or RealClock()
    admission = limits or DemoLimits(
        sessions_per_ip_per_hour=base_config.sessions_per_ip_per_hour,
        max_sessions_per_day=base_config.max_sessions_per_day,
    )
    pending_creations = 0
    stopping = False
    cleanup_tasks: set[asyncio.Task] = set()
    resource_close_tasks: set[asyncio.Task] = set()
    upload_jobs: set[asyncio.Task] = set()
    upload_slot = asyncio.Semaphore(1)
    # References include fail-fast validation and global speech engines, so an
    # injected factory sharing a client never loses it while another room uses it.
    owned: dict[int, tuple[Any, int]] = {}

    def retain(resource: Any) -> None:
        key = id(resource)
        previous = owned.get(key)
        owned[key] = (resource, (previous[1] if previous else 0) + 1)

    async def close_resource(resource: Any) -> None:
        close = getattr(resource, "aclose", None)
        if callable(close):
            try:
                await asyncio.wait_for(close(), _RESOURCE_CLOSE_TIMEOUT_SECONDS)
            except Exception:
                logging.getLogger("frontrow.lifecycle").warning("session_resource_close_failed")

    async def release(resource: Any) -> None:
        key = id(resource)
        previous = owned.get(key)
        if previous is None:
            return
        if previous[1] > 1:
            owned[key] = (resource, previous[1] - 1)
            return
        del owned[key]
        # Ownership is released once. Its close operation has an independent
        # lifetime, so cancelling an idle-end job cannot abandon an SDK mid-close.
        task = asyncio.create_task(close_resource(resource))
        resource_close_tasks.add(task)
        task.add_done_callback(resource_close_tasks.discard)
        await asyncio.shield(task)

    for resource in (validation_llm, tts_engine, stt_provider):
        retain(resource)

    def track_cleanup(task: asyncio.Task) -> None:
        cleanup_tasks.add(task)
        def done(completed: asyncio.Task) -> None:
            cleanup_tasks.discard(completed)
            if not completed.cancelled() and completed.exception() is not None:
                logging.getLogger("frontrow.lifecycle").warning("session_cleanup_failed")
        task.add_done_callback(done)

    def disconnected(live: _Live, client: _Client) -> None:
        live.clients.discard(client)
        if not live.clients and live.disconnected_since is None:
            live.disconnected_since = life_clock.now()

    async def stop_live(live: _Live) -> None:
        """Stop producers before cancelling speech and releasing room ownership."""
        if live.closed:
            return
        live.closing = True
        await live.session.close()
        tasks = list(live.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if not live.resource_released and live.llm is not None:
            live.resource_released = True
            await release(live.llm)
        live.closed = True
        live.closing = False
        if live.ended_at is None:
            live.ended_at = life_clock.now()

    async def finish_live(live: _Live, reason: str) -> None:
        if live.evicted or live.closed:
            return
        now = life_clock.now()
        if reason == "idle" and (live.clients or live.disconnected_since is None
                or now - live.disconnected_since < base_config.idle_end_seconds):
            return
        # A command may own live.lock while awaiting inference. Stop producers
        # before waiting for that lock, or a slow end command defeats the cutoff.
        # No await separates the grace recheck from marking the run as closing.
        live.closing = True
        await live.session.close()
        async with live.lock:
            if live.evicted:
                return
            if live.closed:
                if live.session.state is SessionState.REPORTING:
                    live.session.finish()
                return
            await live.session.end_for_report()
            await stop_live(live)

    async def evict_live(live: _Live) -> None:
        async with live.lock:
            if live.evicted or live.ended_at is None:
                return
            if life_clock.now() - live.ended_at < base_config.session_retention_seconds:
                return
            await stop_live(live)
            live.evicted = True
            sessions.pop(live.session.id, None)
            clients = list(live.clients)
            live.clients.clear()
        # Registry mutation has finished; socket I/O never holds a global lock.
        for client in clients:
            if client.ws is not None:
                with contextlib.suppress(Exception):
                    await client.ws.close(code=4404, reason="session expired")

    def start_sweep() -> None:
        now = life_clock.now()
        for live in list(sessions.values()):
            if live.cleanup_task is not None and not live.cleanup_task.done():
                continue
            job = None
            if live.ended_at is not None and now - live.ended_at >= base_config.session_retention_seconds:
                job = evict_live(live)
            elif not live.closed:
                if live.session.state not in _ACTIVE_STATES:
                    job = finish_live(live, "finished")
                elif now - live.created_at >= base_config.max_session_seconds:
                    job = finish_live(live, "max_age")
                elif not live.clients and live.disconnected_since is not None and now - live.disconnected_since >= base_config.idle_end_seconds:
                    job = finish_live(live, "idle")
            if job is not None:
                live.cleanup_task = asyncio.create_task(job)
                track_cleanup(live.cleanup_task)

    async def sweep_sessions() -> None:
        """Deterministic test/admin seam; the background scanner does not wait."""
        for _ in range(2):  # A zero retention period can evict a just-ended room.
            start_sweep()
            tasks = list(cleanup_tasks)
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

    async def maintain() -> None:
        while True:
            start_sweep()
            await life_clock.sleep(1.0)

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI):
        nonlocal stopping
        maintenance = asyncio.create_task(maintain())
        _app.state.maintenance_task = maintenance
        try:
            yield
        finally:
            stopping = True
            maintenance.cancel()
            await asyncio.gather(maintenance, return_exceptions=True)
            jobs = list(cleanup_tasks)
            for task in jobs:
                task.cancel()
            await asyncio.gather(*jobs, return_exceptions=True)
            await asyncio.gather(*(stop_live(live) for live in list(sessions.values())))
            # A cancelled request cannot stop Python work already running in a
            # thread. Its extraction retains the single permit until completion.
            await asyncio.gather(*list(upload_jobs), return_exceptions=True)
            for resource in (validation_llm, tts_engine, stt_provider):
                await release(resource)
            await asyncio.gather(*list(resource_close_tasks), return_exceptions=True)

    app = FastAPI(title="FrontRow", lifespan=lifespan)
    app.state.sessions = sessions
    app.state.sweep_sessions = sweep_sessions
    origins = os.environ.get("FRONTROW_CORS_ORIGINS", "*").split(",")
    app.add_middleware(
        CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"],
        expose_headers=["Retry-After"],
    )

    # --- session plumbing ---------------------------------------------------

    def get_live(session_id: str) -> _Live:
        live = sessions.get(session_id)
        if live is None:
            raise HTTPException(404, f"session {session_id!r} not found")
        return live

    def active_count() -> int:
        return sum(live.session.state in _ACTIVE_STATES for live in sessions.values())

    def reserve_creation(request: Request | None):
        nonlocal pending_creations
        if stopping or active_count() + pending_creations >= base_config.max_live_sessions:
            raise HTTPException(503, "The practice room is busy. Try again in a few minutes.",
                                headers={"Retry-After": str(max(1, math.ceil(base_config.idle_end_seconds)))})
        peer = request.client.host if request is not None and request.client else None
        forwarded = request.headers.get("x-forwarded-for") if request is not None else None
        try:
            ticket = admission.reserve_session(client_ip(peer, forwarded))
        except LimitExceeded as exc:
            raise HTTPException(exc.status_code, exc.message,
                                headers={"Retry-After": str(exc.retry_after)}) from exc
        # No await separates the live-cap check, quota reservation and slot claim.
        pending_creations += 1
        return ticket

    def publish(live: _Live, message: dict[str, Any]) -> None:
        for client in list(live.clients):
            try:
                client.queue.put_nowait(message)
            except asyncio.QueueFull:
                client.overflowed = True
                disconnected(live, client)

    async def synthesize(live: _Live, event: TimelineEvent) -> None:
        if live.closing or live.closed or live.evicted:
            return
        data = event.data
        qid = data["question_id"]
        record = live.session.orchestrator.record
        if qid not in live.audio:
            try:
                audio = await tts_engine.synthesize(
                    data["question"], persona=data["persona"], listener_id=data["listener"]
                )
            except Exception as exc:  # noqa: BLE001 - audio is best effort
                record("question_audio_failed", question_id=qid, error=str(exc)[:200])
                return
            if live.closing or live.closed or live.evicted:
                return
            live.audio[qid] = audio
        record(
            "question_audio",
            question_id=qid,
            url=f"/sessions/{live.session.id}/audio/{qid}",
            content_type=live.audio[qid].content_type,
        )

    def on_event(session_id: str, event: TimelineEvent) -> None:
        live = sessions.get(session_id)
        if live is None:
            return
        publish(live, _event_out(event))
        if not (live.closing or live.closed or live.evicted) and event.type in _SPOKEN_EVENTS and not isinstance(tts_engine, NoTTS):
            task = asyncio.get_running_loop().create_task(synthesize(live, event))
            live.tasks.add(task)
            task.add_done_callback(live.tasks.discard)

    def new_session(preset: str, slides: list[Slide], tick: float | None) -> Session:
        if preset not in ROOM_PRESETS:
            raise HTTPException(
                400, f"unknown preset {preset!r}; choose from {sorted(ROOM_PRESETS)}"
            )
        cfg = base_config
        if tick is not None:
            try:
                cfg = Config(
                    **{
                        **base_config.model_dump(),
                        "tick_interval_seconds": tick,
                        "per_listener_timeout_seconds": min(
                            base_config.per_listener_timeout_seconds, tick * 2 / 3
                        ),
                    }
                )
            except ValidationError as exc:
                raise HTTPException(400, f"invalid tick_interval_seconds: {tick}") from exc
        session_ref: list[str] = []
        llm = make_llm()
        session = Session(
            config=cfg,
            clock=clock_factory(),
            llm=llm,
            slides=slides,
            preset=preset,
            event_sink=lambda e: on_event(session_ref[0], e),
        )
        session_ref.append(session.id)
        retain(llm)
        now = life_clock.now()
        sessions[session.id] = _Live(session=session, llm=llm,
                                     created_at=now, disconnected_since=now)
        return session

    # --- REST ---------------------------------------------------------------

    @app.get("/health")
    async def health() -> dict[str, Any]:
        live = active_count()
        return {"ok": True, "sessions": len(sessions), "live_sessions": live,
                "retained_sessions": len(sessions) - live}

    @app.post("/sessions", status_code=201, response_model=SessionInfo)
    async def create_session(body: CreateSessionRequest, request: Request = None) -> SessionInfo:
        nonlocal pending_creations
        ticket = reserve_creation(request)
        try:
            slides = [Slide(index=i, text=s.text) for i, s in enumerate(body.slides)]
            result = session_info(new_session(body.preset, slides, body.tick_interval_seconds))
            ticket.commit()
            return result
        except BaseException:
            ticket.rollback()
            raise
        finally:
            pending_creations -= 1

    @app.post("/sessions/upload", status_code=201, response_model=SessionInfo)
    async def upload_session(
        file: UploadFile = File(...),
        preset: str = Form("default"),
        tick_interval_seconds: float | None = Form(None),
        request: Request = None,
    ) -> SessionInfo:
        nonlocal pending_creations
        ticket = reserve_creation(request)
        try:
            await upload_slot.acquire()
            try:
                data = await file.read(MAX_UPLOAD_BYTES + 1)
                extraction = asyncio.create_task(asyncio.to_thread(extract_slides, data))
            except BaseException:
                upload_slot.release()
                raise
            upload_jobs.add(extraction)
            def extracted(job: asyncio.Task) -> None:
                upload_jobs.discard(job)
                upload_slot.release()
                if not job.cancelled():
                    job.exception()  # Retrieve failures even if the request went away.
            extraction.add_done_callback(extracted)
            try:
                slides = await asyncio.shield(extraction)
            except SlideError as exc:
                status = 413 if len(data) > MAX_UPLOAD_BYTES else 400
                raise HTTPException(status, str(exc)) from exc
            result = session_info(new_session(preset, slides, tick_interval_seconds))
            ticket.commit()
            return result
        except BaseException:
            ticket.rollback()
            raise
        finally:
            pending_creations -= 1

    @app.get("/sessions/{session_id}", response_model=SessionInfo)
    async def get_session(session_id: str) -> SessionInfo:
        return session_info(get_live(session_id).session)

    @app.get("/sessions/{session_id}/events")
    async def get_events(session_id: str, since: int = 0) -> list[dict[str, Any]]:
        """Timeline backlog from index ``since`` (for debugging or late joiners)."""
        return [_event_out(e) for e in get_live(session_id).session.events[since:]]

    @app.post("/sessions/{session_id}/stt-token")
    async def stt_token(session_id: str) -> dict[str, Any]:
        live = get_live(session_id)
        if live.closing or live.closed or live.session.state not in _ACTIVE_STATES:
            raise HTTPException(409, f"session is {live.session.state.value}")
        if live.stt_attempts >= base_config.stt_tokens_per_session:
            remaining = max(1, math.ceil(base_config.max_session_seconds - (life_clock.now() - live.created_at)))
            raise HTTPException(429, "This session has reached its voice-token limit. Continue by typing to the room, or start a new session.",
                                headers={"Retry-After": str(remaining)})
        # Count attempts before the provider await; an unconfirmed issuance may
        # still cost money, and concurrent requests cannot oversubscribe the cap.
        live.stt_attempts += 1
        job = asyncio.create_task(stt_provider.create_token(session_id))
        live.tasks.add(job)
        job.add_done_callback(live.tasks.discard)
        try:
            token = await job
        except asyncio.CancelledError:
            if live.closing or live.closed or live.evicted:
                raise HTTPException(409, "This practice session has ended.") from None
            raise
        except SpeechNotConfigured as exc:
            raise HTTPException(501, str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - surface provider failures as 502
            raise HTTPException(502, f"STT token provider failed: {exc}") from exc
        if live.closing or live.closed or live.evicted:
            raise HTTPException(409, "This practice session has ended.")
        return {
            "token": token.token,
            "provider": token.provider,
            "expires_in_seconds": token.expires_in_seconds,
            **token.extra,
        }

    @app.get("/sessions/{session_id}/audio/{question_id}")
    async def question_audio(session_id: str, question_id: str) -> Response:
        audio = get_live(session_id).audio.get(question_id)
        if audio is None:
            raise HTTPException(404, f"no audio for question {question_id!r}")
        return Response(content=audio.data, media_type=audio.content_type)

    @app.get("/sessions/{session_id}/report")
    async def report(session_id: str) -> dict[str, Any]:
        session = get_live(session_id).session
        if session.state not in (SessionState.REPORTING, SessionState.ENDED):
            raise HTTPException(
                409, f"report not available yet (session is {session.state.value})"
            )
        return await asyncio.to_thread(session_summary, session)

    # --- WebSocket ----------------------------------------------------------

    async def dispatch(session: Session, msg: Any) -> dict[str, Any]:
        kind = msg.type
        if kind == "start":
            session.start()
        elif kind == "transcript":
            chunk = session.ingest_transcript(msg.seq, msg.text, msg.duration)
            return {"accepted": chunk is not None}
        elif kind == "slide":
            session.change_slide(msg.index)
        elif kind == "take_question":
            return {"question_id": session.take_question(msg.question_id).question_id}
        elif kind == "playback_started":
            session.playback_started(msg.question_id)
        elif kind == "playback_ended":
            session.playback_ended(msg.question_id)
        elif kind == "answer_done":
            session.answer_done(msg.question_id)
        elif kind == "end_presenting":
            await session.end_presenting()
            return {"qa_pool": len(session.moderator.qa_pool)}
        elif kind == "next_question":
            hand = await session.next_qa_question()
            return {"question_id": hand.question_id if hand else None, "done": hand is None}
        elif kind == "end_qa":
            await session.end_qa()
        elif kind == "finish":
            session.finish()
        elif kind == "ping":
            return {"pong": True}
        return {}

    async def handle(live: _Live, raw: str) -> dict[str, Any]:
        try:
            msg = client_message_adapter.validate_json(raw)
        except ValidationError as exc:
            hint: dict[str, Any] = {}
            with contextlib.suppress(ValueError):
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    hint = parsed
            return ErrorMessage(
                id=hint.get("id") if isinstance(hint.get("id"), (str, int)) else None,
                request=hint.get("type") if isinstance(hint.get("type"), str) else None,
                message="message does not match the protocol",
                detail=exc.errors(include_url=False, include_context=False, include_input=False),
            ).model_dump(mode="json")
        async with live.lock:
            try:
                if (live.closing or live.closed or live.evicted) and msg.type not in ("finish", "ping", "playback_ended"):
                    raise SessionError("session has ended")
                if msg.type == "finish" and live.session.state is SessionState.ENDED:
                    result = {}
                else:
                    result = await dispatch(live.session, msg)
                if live.session.state not in _ACTIVE_STATES:
                    await stop_live(live)
            except SessionError as exc:
                return ErrorMessage(id=msg.id, request=msg.type, message=str(exc)).model_dump(mode="json")
            except asyncio.CancelledError:
                # A policy cutoff can cancel a child tick awaited by this command.
                # External cancellation of the WebSocket task must still propagate.
                task = asyncio.current_task()
                if live.closing and task is not None and not task.cancelling():
                    return ErrorMessage(id=msg.id, request=msg.type, message="session has ended").model_dump(mode="json")
                raise
        return AckMessage(id=msg.id, request=msg.type, result=result).model_dump(mode="json")

    async def pump(ws: WebSocket, client: _Client) -> None:
        while True:
            if client.overflowed and client.queue.empty():
                await ws.close(code=1013, reason="client too slow")
                return
            await ws.send_json(await client.queue.get())

    @app.websocket("/sessions/{session_id}/ws")
    async def session_ws(ws: WebSocket, session_id: str, replay: bool = False) -> None:
        await ws.accept()
        live = sessions.get(session_id)
        if live is None:
            await ws.send_json(
                ErrorMessage(message=f"session {session_id!r} not found").model_dump(mode="json")
            )
            await ws.close(code=4404, reason="session not found")
            return

        client = _Client(ws=ws)
        # Queue the hello and subscribe with no await in between, so the
        # backlog and the live stream neither overlap nor leave a gap.
        hello = HelloMessage(
            session=session_info(live.session),
            events=[EventOut(event=e.type, t=e.t, data=e.data) for e in live.session.events]
            if replay
            else [],
        )
        client.queue.put_nowait(hello.model_dump(mode="json"))
        live.clients.add(client)
        live.disconnected_since = None
        sender = asyncio.create_task(pump(ws, client))
        try:
            while True:
                raw = await ws.receive_text()
                reply = await handle(live, raw)
                await client.queue.put(reply)
        except (WebSocketDisconnect, RuntimeError):
            # RuntimeError: the socket was already closed (e.g. client too slow).
            pass
        finally:
            disconnected(live, client)
            sender.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await sender

    return app


app = create_app()
