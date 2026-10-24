"""Offline provider integration checks, using in-memory SDK stand-ins only.

These ordinary assertion functions join verify.py's dependency-light runner.
No real provider SDK, credentials, or network connection is needed.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
from contextlib import contextmanager
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from frontrow.config import Config
from frontrow.llm.fake import FakeLLM
from frontrow.llm.fallback import FallbackLLM
from frontrow.personas import ALL_PERSONAS, ROOM_PRESETS, build_room
from frontrow.speech import NoSTTTokens, NoTTS


@contextmanager
def _environment(**values):
    # Never let a developer's keys or provider selection affect offline checks.
    with patch.dict(os.environ, values, clear=True):
        yield


def _error(call, *fragments):
    try:
        call()
    except (RuntimeError, ValueError, ImportError) as exc:
        message = str(exc).lower()
        assert all(fragment.lower() in message for fragment in fragments), str(exc)
        return exc
    raise AssertionError(f"expected an error containing {fragments!r}")


def _server():
    # server exposes an import-time default app; ensure that app is always offline.
    with _environment(FRONTROW_LLM="fake", FRONTROW_TTS="none", FRONTROW_STT="none"):
        return importlib.import_module("frontrow.server")


@contextmanager
def _sdk_stubs():
    state = SimpleNamespace(http=[], elevenlabs=[], anthropic=[], openai=[],
                            tts_calls=[], token_calls=[], anthropic_calls=[],
                            text='{"ok":true}', blocks=None, provider_failure=None)

    class HTTPClient:
        def __init__(self, **kwargs):
            self.options = kwargs
            self.closed = False
            state.http.append(self)

        async def aclose(self):
            self.closed = True

    class ElevenLabs:
        def __init__(self, **kwargs):
            self.options = kwargs
            state.elevenlabs.append(self)
            self.text_to_speech = SimpleNamespace(convert=self.convert)
            self.tokens = SimpleNamespace(single_use=SimpleNamespace(create=self.token))

        async def convert(self, **kwargs):
            state.tts_calls.append(kwargs)
            if state.provider_failure:
                raise RuntimeError(state.provider_failure)
            yield b"ID3"
            yield b"offline-mp3"

        async def token(self, **kwargs):
            state.token_calls.append(kwargs)
            if state.provider_failure:
                raise RuntimeError(state.provider_failure)
            return SimpleNamespace(token="offline-single-use-token")

    class Anthropic:
        def __init__(self, **kwargs):
            self.options = kwargs
            self.close_calls = 0
            state.anthropic.append(self)
            self.messages = SimpleNamespace(create=self.create)

        async def close(self):
            self.close_calls += 1

        async def create(self, **kwargs):
            state.anthropic_calls.append(kwargs)
            if state.provider_failure == "timeout":
                raise asyncio.TimeoutError()
            if state.provider_failure:
                raise RuntimeError(state.provider_failure)
            blocks = state.blocks if state.blocks is not None else [SimpleNamespace(type="text", text=state.text)]
            return SimpleNamespace(content=blocks, stop_reason="end_turn")

    class OpenAI:
        def __init__(self, **kwargs):
            self.options = kwargs
            self.close_calls = 0
            state.openai.append(self)

        async def close(self):
            self.close_calls += 1

    modules = {}
    for name in ("httpx", "elevenlabs", "elevenlabs.client", "anthropic", "openai"):
        modules[name] = ModuleType(name)
    modules["httpx"].AsyncClient = HTTPClient
    modules["elevenlabs"].__path__ = []
    modules["elevenlabs.client"].AsyncElevenLabs = ElevenLabs
    modules["anthropic"].AsyncAnthropic = Anthropic
    modules["openai"].AsyncOpenAI = OpenAI
    with patch.dict(sys.modules, modules):
        yield state


async def _close(*engines):
    for engine in engines:
        close = getattr(engine, "aclose", None)
        if close:
            await close()


def check_provider_config_defaults() -> None:
    assert Config().llm_model == "gpt-4o-mini", "plain Config() must retain its existing default"
    for provider, expected in (("fake", "gpt-4o-mini"), ("openai", "gpt-4o-mini"),
                               ("anthropic", "claude-haiku-5-5")):
        with _environment(FRONTROW_LLM=provider):
            assert Config.from_env().llm_model == expected
        with _environment(FRONTROW_LLM=provider, FRONTROW_LLM_MODEL="  "):
            assert Config.from_env().llm_model == expected
        with _environment(FRONTROW_LLM=provider, FRONTROW_LLM_MODEL="explicit-model"):
            assert Config.from_env().llm_model == "explicit-model"
            assert Config.from_env(llm_model="override-model").llm_model == "override-model"
    with _environment(FRONTROW_TICK_INTERVAL_SECONDS="5"):
        cfg = Config.from_env()
        assert cfg.tick_interval_seconds == 5 and abs(cfg.per_listener_timeout_seconds - 10 / 3) < 1e-9
    with _environment():
        cfg = Config.from_env(tick_interval_seconds=5)
        assert abs(cfg.per_listener_timeout_seconds - 10 / 3) < 1e-9
    with _environment(FRONTROW_TICK_INTERVAL_SECONDS="5", FRONTROW_PER_LISTENER_TIMEOUT_SECONDS="10"):
        _error(Config.from_env, "per_listener_timeout_seconds")


def check_llm_provider_factories() -> None:
    server = _server()
    with _sdk_stubs():
        for env in ({}, {"FRONTROW_LLM": ""}, {"FRONTROW_LLM": "fake"}):
            with _environment(**env):
                assert isinstance(server.llm_from_env()(), FakeLLM)
        for provider, class_name, key in (("openai", "OpenAIClient", "OPENAI_API_KEY"),
                                         ("anthropic", "AnthropicClient", "ANTHROPIC_API_KEY")):
            with _environment(FRONTROW_LLM=provider, **{key: "offline-key"}):
                llm = server.llm_from_env()()
                assert isinstance(llm, FallbackLLM)
                assert type(llm.primary).__name__ == class_name
                assert isinstance(llm.fallback, FakeLLM)
        with _environment(FRONTROW_LLM="unknown-provider"):
            _error(server.llm_from_env, "FRONTROW_LLM", "fake", "openai", "anthropic")


def check_speech_provider_factories() -> None:
    server = _server()
    with _sdk_stubs():
        for env in ({}, {"FRONTROW_TTS": "", "FRONTROW_STT": ""},
                    {"FRONTROW_TTS": "none", "FRONTROW_STT": "none"}):
            with _environment(**env):
                tts, stt = server.speech_engines_from_env()
                assert isinstance(tts, NoTTS) and isinstance(stt, NoSTTTokens)
        for tts_kind, stt_kind in (("elevenlabs", "none"), ("none", "elevenlabs"),
                                    ("elevenlabs", "elevenlabs")):
            with _environment(FRONTROW_TTS=tts_kind, FRONTROW_STT=stt_kind,
                              ELEVENLABS_API_KEY="offline-key"):
                tts, stt = server.speech_engines_from_env()
                assert type(tts).__name__ == ("ElevenLabsTTS" if tts_kind == "elevenlabs" else "NoTTS")
                assert type(stt).__name__ == ("ElevenLabsSTTTokens" if stt_kind == "elevenlabs" else "NoSTTTokens")
                asyncio.run(_close(tts, stt))
        for variable in ("FRONTROW_TTS", "FRONTROW_STT"):
            with _environment(**{variable: "unknown-provider"}):
                _error(server.speech_engines_from_env, variable, "none", "elevenlabs")


def check_optional_provider_errors() -> None:
    from frontrow.llm.anthropic_client import AnthropicClient
    from frontrow.llm.openai_client import OpenAIClient
    from frontrow.speech_elevenlabs import ElevenLabsSTTTokens, ElevenLabsTTS

    # None in sys.modules models missing extras even on a fully installed machine.
    for module, constructor, extra in (("anthropic", AnthropicClient, "anthropic"),
                                        ("openai", OpenAIClient, "openai")):
        with _environment(), patch.dict(sys.modules, {module: None}):
            _error(lambda: constructor(api_key="offline-key"), extra, "install")
    for constructor in (ElevenLabsTTS, ElevenLabsSTTTokens):
        with _environment(), patch.dict(sys.modules, {"elevenlabs": None, "elevenlabs.client": None}):
            _error(lambda: constructor(api_key="offline-key"), "elevenlabs", "--extra elevenlabs")
        with _environment(), patch.dict(sys.modules, {"httpx": None}):
            _error(lambda: constructor(api_key="offline-key"), "elevenlabs", "--extra elevenlabs")
    with _sdk_stubs(), _environment():
        for constructor, key in ((AnthropicClient, "ANTHROPIC_API_KEY"),
                                  (OpenAIClient, "OPENAI_API_KEY"),
                                  (ElevenLabsTTS, "ELEVENLABS_API_KEY"),
                                  (ElevenLabsSTTTokens, "ELEVENLABS_API_KEY")):
            _error(constructor, key)


def check_voice_map_and_duplicate_listeners() -> None:
    from frontrow.speech_elevenlabs import ElevenLabsTTS

    with _sdk_stubs(), _environment(ELEVENLABS_API_KEY="offline-key"):
        engine = ElevenLabsTTS()
        try:
            assert set(engine.voices) == {persona.name for persona in ALL_PERSONAS}
            primary = []
            for persona in ALL_PERSONAS:
                voices = engine.voices[persona.name]
                assert len(voices) >= 2 and len(set(voices)) == len(voices), (persona.name, voices)
                assert all(isinstance(voice, str) and voice.strip() and voice != "TODO" for voice in voices)
                primary.append(voices[0])
                assert engine.voice_for(persona.name, "L0") == voices[0]
                assert engine.voice_for(persona.name, "L3") == voices[3 % len(voices)]
            assert len(set(primary)) == len(primary), "each persona needs a distinct primary voice"
            for preset in ROOM_PRESETS:
                selected = {}
                for listener_id, persona in build_room(preset):
                    selected.setdefault(persona.name, []).append(engine.voice_for(persona.name, listener_id))
                for persona, voices in selected.items():
                    assert len(voices) == len(set(voices)), (preset, persona, voices)
        finally:
            asyncio.run(engine.aclose())


def check_voice_pools_and_room_assignments_are_disjoint() -> None:
    """Different personas and every listener in a preset need distinct voices."""
    from frontrow.speech_elevenlabs import ElevenLabsTTS

    with _sdk_stubs(), _environment(ELEVENLABS_API_KEY="offline-key"):
        engine = ElevenLabsTTS()
        try:
            owners = {}
            for persona, voices in engine.voices.items():
                for voice in voices:
                    owners.setdefault(voice, set()).add(persona)
            pool_collisions = {voice: sorted(personas) for voice, personas in owners.items()
                               if len(personas) > 1}
            room_collisions = {}
            for preset in ROOM_PRESETS:
                selected = {}
                for listener_id, persona in build_room(preset):
                    voice = engine.voice_for(persona.name, listener_id)
                    selected.setdefault(voice, []).append(f"{listener_id} ({persona.name})")
                duplicates = {voice: listeners for voice, listeners in selected.items()
                              if len(listeners) > 1}
                if duplicates:
                    room_collisions[preset] = duplicates
            assert not pool_collisions and not room_collisions, (
                f"Shared persona pools: {pool_collisions}; "
                f"duplicate room voices: {room_collisions}"
            )
        finally:
            asyncio.run(engine.aclose())


def check_elevenlabs_tts_client_reuse_and_token_contract() -> None:
    from frontrow.speech_elevenlabs import ElevenLabsSTTTokens, ElevenLabsTTS

    async def run(state):
        tts = ElevenLabsTTS()
        tokens = ElevenLabsSTTTokens()
        try:
            first = await tts.synthesize("Why does that work?", persona=ALL_PERSONAS[0].name, listener_id="L0")
            second = await tts.synthesize("And the edge case?", persona=ALL_PERSONAS[0].name, listener_id="L1")
            assert first.data == second.data == b"ID3offline-mp3"
            assert first.content_type == "audio/mpeg"
            assert len(state.http) == len(state.elevenlabs) == 2, "one reusable HTTP/SDK client per engine"
            for call in state.tts_calls:
                assert call["model_id"] == "eleven_flash_v2_5"
                assert call["output_format"] == "mp3_44100_128"
                assert call["request_options"] == {"max_retries": 0}
            assert state.tts_calls[0]["voice_id"] != state.tts_calls[1]["voice_id"]
            token = await tokens.create_token("offline-session")
            assert token.token == "offline-single-use-token" and token.provider == "elevenlabs"
            assert token.expires_in_seconds == 900
            assert token.extra == {"model_id": "scribe_v2_realtime", "vad_silence_threshold_secs": 0.7,
                                   "include_timestamps": True}
            assert state.token_calls == [{"token_type": "realtime_scribe", "request_options": {"max_retries": 0}}]
        finally:
            await _close(tts, tokens)
        assert all(client.closed for client in state.http), "owned clients must close on engine shutdown"

    with _sdk_stubs() as state, _environment(ELEVENLABS_API_KEY="offline-key"):
        asyncio.run(run(state))


def check_elevenlabs_failures_are_sanitized() -> None:
    from frontrow.speech_elevenlabs import ElevenLabsSTTTokens, ElevenLabsTTS

    async def run():
        tts, tokens = ElevenLabsTTS(), ElevenLabsSTTTokens()
        try:
            for operation in (lambda: tts.synthesize("Question", persona=ALL_PERSONAS[0].name, listener_id="L0"),
                              lambda: tokens.create_token("offline-session")):
                try:
                    await operation()
                except RuntimeError as exc:
                    assert "PRIVATE_PROVIDER_RESPONSE" not in str(exc)
                    assert "offline-key" not in str(exc)
                else:
                    raise AssertionError("provider failure must not look successful")
        finally:
            await _close(tts, tokens)

    with _sdk_stubs() as state, _environment(ELEVENLABS_API_KEY="offline-key"):
        state.provider_failure = "PRIVATE_PROVIDER_RESPONSE offline-key"
        asyncio.run(run())


def check_anthropic_completion_and_json_contract() -> None:
    from frontrow.llm.anthropic_client import AnthropicClient

    async def run(state):
        client = AnthropicClient(api_key="explicit-offline-key")
        assert state.anthropic[0].options["api_key"] == "explicit-offline-key"
        assert state.anthropic[0].options.get("max_retries") == 0
        state.blocks = [SimpleNamespace(type="thinking", thinking="private thinking"),
                        SimpleNamespace(type="text", text='Here is the JSON: {"attention":'),
                        SimpleNamespace(type="tool_use", name="ignored"),
                        SimpleNamespace(type="text", text='70,"confusion":20}')]
        raw = await client.complete("A room system prompt", "A user transcript", model="claude-haiku-5-5", timeout=3.25)
        assert json.loads(raw) == {"attention": 70, "confusion": 20}
        args = state.anthropic_calls[-1]
        assert args["model"] == "claude-haiku-5-5" and args["timeout"] == 3.25
        assert args["max_tokens"] == 1024
        assert args["system"].startswith("A room system prompt") and "json" in args["system"].lower()
        assert args["messages"] == [{"role": "user", "content": "A user transcript"}]
        assert args.get("thinking") == {"type": "disabled"}
        state.blocks = None
        for invalid in ("", "not json", '["array-only"]'):
            state.text = invalid
            try:
                await client.complete("s", "u", model="explicit-other-model", timeout=1.0)
            except ValueError:
                pass
            else:
                raise AssertionError(f"invalid JSON object should raise: {invalid!r}")
        assert "thinking" not in state.anthropic_calls[-1], "keep explicit non-Haiku model options unchanged"

    with _sdk_stubs() as state, _environment(ANTHROPIC_API_KEY="environment-offline-key"):
        asyncio.run(run(state))


def check_anthropic_errors_use_existing_fallback() -> None:
    from frontrow.llm.anthropic_client import AnthropicClient

    async def run(state):
        for failure in ("provider failure", "timeout"):
            state.provider_failure = failure
            reasons = []
            fallback = FallbackLLM(AnthropicClient(), on_fallback=reasons.append)
            result = await fallback.complete_json("system", "user", model="claude-haiku-5-5", timeout=0.1)
            assert isinstance(result, dict)
            assert fallback.fallback_count == 1 and len(reasons) == 1
            if failure == "timeout":
                assert reasons == ["timeout"]
        state.provider_failure = None
        state.text = "not json"
        fallback = FallbackLLM(AnthropicClient())
        assert isinstance(await fallback.complete_json("s", "u", model="claude-haiku-5-5", timeout=0.1), dict)
        assert fallback.fallback_count == 1

    with _sdk_stubs() as state, _environment(ANTHROPIC_API_KEY="offline-key"):
        asyncio.run(run(state))


def _endpoint(app, path, method):
    return next(route.endpoint for route in app.routes
                if getattr(route, "path", None) == path and method in getattr(route, "methods", set()))


def check_injected_speech_ignores_unused_provider_configuration() -> None:
    from frontrow.protocol import CreateSessionRequest
    from frontrow.speech import SpeechAudio, STTToken

    server = _server()

    class InjectedTTS:
        def __bool__(self):
            return False  # Injection means non-None, not truthiness.

        async def synthesize(self, text, *, persona, listener_id):
            return SpeechAudio(data=b"injected")

    class InjectedTokens:
        def __bool__(self):
            return False

        async def create_token(self, session_id):
            return STTToken(token="injected-token", provider="injected")

    async def exercise(app, expected_token=None):
        async with app.router.lifespan_context(app):
            info = await _endpoint(app, "/sessions", "POST")(CreateSessionRequest())
            if expected_token is not None:
                token = await _endpoint(app, "/sessions/{session_id}/stt-token", "POST")(info.id)
                assert token["token"] == expected_token

    missing_sdk = {"elevenlabs": None, "elevenlabs.client": None}
    # Both injected, and either partial injection, must ignore invalid/unavailable
    # providers belonging only to the supplied dependencies.
    cases = [
        ({"FRONTROW_TTS": "invalid-ignored", "FRONTROW_STT": "invalid-ignored"},
         {"tts": InjectedTTS(), "stt_tokens": InjectedTokens()}, "injected-token"),
        ({"FRONTROW_TTS": "elevenlabs", "FRONTROW_STT": "elevenlabs"},
         {"tts": InjectedTTS(), "stt_tokens": InjectedTokens()}, "injected-token"),
        ({"FRONTROW_TTS": "invalid-ignored", "FRONTROW_STT": "none"},
         {"tts": InjectedTTS()}, None),
        ({"FRONTROW_TTS": "none", "FRONTROW_STT": "invalid-ignored"},
         {"stt_tokens": InjectedTokens()}, "injected-token"),
        ({"FRONTROW_TTS": "elevenlabs", "FRONTROW_STT": "none"},
         {"tts": InjectedTTS()}, None),
        ({"FRONTROW_TTS": "none", "FRONTROW_STT": "elevenlabs"},
         {"stt_tokens": InjectedTokens()}, "injected-token"),
    ]
    for env, injected, expected_token in cases:
        with _environment(**env), patch.dict(sys.modules, missing_sdk):
            app = server.create_app(config=Config(), llm_factory=FakeLLM, **injected)
            asyncio.run(exercise(app, expected_token))

    # The provider that is actually requested must still validate its config.
    for variable, injected in (("FRONTROW_STT", {"tts": InjectedTTS()}),
                                ("FRONTROW_TTS", {"stt_tokens": InjectedTokens()})):
        with _environment(**{variable: "invalid-selected"}):
            _error(lambda: server.create_app(config=Config(), llm_factory=FakeLLM, **injected), variable)
        with _environment(**{variable: "elevenlabs"}), patch.dict(sys.modules, missing_sdk):
            _error(lambda: server.create_app(config=Config(), llm_factory=FakeLLM, **injected),
                   "elevenlabs", "--extra elevenlabs")

    # A partial override constructs and closes only the one selected real engine.
    for variable, injected, expected_token in (("FRONTROW_STT", {"tts": InjectedTTS()}, "offline-single-use-token"),
                                               ("FRONTROW_TTS", {"stt_tokens": InjectedTokens()}, "injected-token")):
        ignored = "FRONTROW_TTS" if variable == "FRONTROW_STT" else "FRONTROW_STT"
        with _sdk_stubs() as state, _environment(**{variable: "elevenlabs", ignored: "invalid-ignored",
                                                    "ELEVENLABS_API_KEY": "offline-key"}):
            app = server.create_app(config=Config(), llm_factory=FakeLLM, **injected)
            asyncio.run(exercise(app, expected_token))
            assert len(state.http) == len(state.elevenlabs) == 1
            assert state.http[0].closed


def check_shutdown_settles_late_voice_tasks_before_clients_close() -> None:
    from frontrow.protocol import CreateSessionRequest
    from frontrow.speech import STTToken

    server = _server()
    original_close = server.Session.close

    async def run():
        order = []
        started = {}
        active = set()
        voice_tasks = []
        closed_sessions = []

        class VoiceEngine:
            closed = 0

            async def synthesize(self, text, *, persona, listener_id):
                active.add(text)
                voice_tasks.append(asyncio.current_task())
                started[text].set()
                order.append(f"voice_started:{text}")
                try:
                    await asyncio.Future()
                finally:
                    active.remove(text)
                    order.append(f"voice_stopped:{text}")

            async def aclose(self):
                assert not active, "voice tasks must settle before closing their HTTP client"
                assert len(closed_sessions) == 2
                self.closed += 1
                order.append("tts_closed")

        class TokenEngine:
            closed = 0

            async def create_token(self, session_id):
                return STTToken(token="offline", provider="offline")

            async def aclose(self):
                assert not active
                self.closed += 1
                order.append("stt_closed")

        class ClosingLLM(FakeLLM):
            def __init__(self, name):
                self.name = name
                self.closed = 0

            async def aclose(self):
                assert not active and len(closed_sessions) == 2
                self.closed += 1
                order.append(f"llm_closed:{self.name}")

        validation = ClosingLLM("validation")
        shared_room = ClosingLLM("shared_rooms")
        factory_calls = 0

        def make_llm():
            nonlocal factory_calls
            factory_calls += 1
            return validation if factory_calls == 1 else shared_room

        async def close_with_late_hand(session):
            await original_close(session)
            # Session.close waits for an in-flight tick. That tick can emit a
            # hand raise while close is awaited, enqueuing a last speech task.
            text = f"late-question-{session.id}"
            started[text] = asyncio.Event()
            session.orchestrator.record("hand_raised", question_id=text, listener="L0",
                                        persona=ALL_PERSONAS[0].name, question=text)
            await asyncio.wait_for(started[text].wait(), timeout=1)
            closed_sessions.append(session.id)
            order.append(f"session_closed:{text}")

        voice, tokens = VoiceEngine(), TokenEngine()
        with patch.object(server.Session, "close", close_with_late_hand):
            app = server.create_app(config=Config(), llm_factory=make_llm, tts=voice, stt_tokens=tokens)
            async with app.router.lifespan_context(app):
                create = _endpoint(app, "/sessions", "POST")
                await create(CreateSessionRequest())
                await create(CreateSessionRequest())
        assert len(voice_tasks) == 2 and all(task.done() and task.cancelled() for task in voice_tasks)
        assert validation.closed == shared_room.closed == voice.closed == tokens.closed == 1
        for text in started:
            assert order.index(f"session_closed:{text}") < order.index(f"voice_stopped:{text}")
            assert order.index(f"voice_stopped:{text}") < order.index("tts_closed")
        assert factory_calls == 3  # Validation plus two rooms; listener references share the room client.

    with _environment():
        asyncio.run(run())


def check_optional_llm_client_closure_is_forwarded_once() -> None:
    from frontrow.llm.anthropic_client import AnthropicClient
    from frontrow.llm.openai_client import OpenAIClient

    async def run(state):
        primary = AnthropicClient()
        fallback = OpenAIClient()
        wrapper = FallbackLLM(primary, fallback=fallback)
        await wrapper.aclose()
        await wrapper.aclose()
        await primary.aclose()
        await fallback.aclose()
        assert state.anthropic[0].close_calls == state.openai[0].close_calls == 1
        shared = AnthropicClient()
        shared_wrapper = FallbackLLM(shared, fallback=shared)
        await shared_wrapper.aclose()
        await shared_wrapper.aclose()
        assert state.anthropic[1].close_calls == 1
        await FallbackLLM(FakeLLM(), fallback=FakeLLM()).aclose()

    with _sdk_stubs() as state, _environment(ANTHROPIC_API_KEY="offline-key", OPENAI_API_KEY="offline-key"):
        asyncio.run(run(state))


def check_expressive_tts_socket_transport_offline() -> None:
    import base64
    from urllib.parse import parse_qs, urlparse

    from frontrow.speech_elevenlabs import ElevenLabsTTS

    async def run(state):
        for model in ("eleven_v4_turbo", "eleven_v3_conversational"):
            sent = []
            responses = [json.dumps({"audio": base64.b64encode(b"ID3").decode()}),
                         json.dumps({"audio": base64.b64encode(b"expressive").decode(), "is_final": True})]
            connections = []

            class Socket:
                async def send(self, raw):
                    sent.append(json.loads(raw))

                async def recv(self):
                    return responses.pop(0)

            class Connection:
                exited = False

                async def __aenter__(self):
                    return Socket()

                async def __aexit__(self, *args):
                    self.exited = True

            def connect(uri, **kwargs):
                connection = Connection()
                connections.append((uri, kwargs, connection))
                return connection

            modules = {name: ModuleType(name) for name in
                       ("websockets", "websockets.asyncio", "websockets.asyncio.client")}
            modules["websockets"].__path__ = []
            modules["websockets.asyncio"].__path__ = []
            modules["websockets.asyncio.client"].connect = connect
            with patch.dict(sys.modules, modules), patch.dict(os.environ, {"FRONTROW_TTS_MODEL": model}):
                engine = ElevenLabsTTS()
                try:
                    voice = engine.voice_for(ALL_PERSONAS[0].name, "L0")
                    audio = await engine.synthesize("[curious] Why?", persona=ALL_PERSONAS[0].name, listener_id="L0")
                    assert audio.data == b"ID3expressive" and audio.content_type == "audio/mpeg"
                    assert sent == [{"voices": [voice]},
                                    {"inputs": [{"text": "[curious] Why?", "voice_id": voice, "new_turn": False}]},
                                    {"close_socket": True}]
                    uri, kwargs, connection = connections[0]
                    assert parse_qs(urlparse(uri).query) == {"model_id": [model], "output_format": ["mp3_44100_128"]}
                    assert kwargs["additional_headers"] == {"xi-api-key": "offline-key"}
                    assert connection.exited and not state.tts_calls, "expressive models use the socket, not REST"
                    responses.append(json.dumps({"error": "PRIVATE_PROVIDER_RESPONSE"}))
                    try:
                        await engine.synthesize("Again", persona=ALL_PERSONAS[0].name, listener_id="L0")
                    except RuntimeError as exc:
                        assert "PRIVATE_PROVIDER_RESPONSE" not in str(exc)
                    else:
                        raise AssertionError("socket provider errors must fail safely")
                    assert connections[-1][2].exited
                finally:
                    await engine.aclose()

    with _sdk_stubs() as state, _environment(ELEVENLABS_API_KEY="offline-key"):
        asyncio.run(run(state))


VOICE_CHECKS = [
    ("provider-aware models and short-tick timeout defaults", check_provider_config_defaults),
    ("LLM factories: fake/OpenAI/Anthropic + unknown provider", check_llm_provider_factories),
    ("speech factories: stand-ins/ElevenLabs + unknown provider", check_speech_provider_factories),
    ("optional SDK and missing-key errors stay clear", check_optional_provider_errors),
    ("voice map covers personas with distinct duplicate voices in every room", check_voice_map_and_duplicate_listeners),
    ("voice pools are disjoint and all room listeners have unique voices", check_voice_pools_and_room_assignments_are_disjoint),
    ("ElevenLabs: reusable clients, MP3 chunks, STT token contract", check_elevenlabs_tts_client_reuse_and_token_contract),
    ("ElevenLabs provider failures redact response bodies", check_elevenlabs_failures_are_sanitized),
    ("Anthropic: request options and JSON-only completion", check_anthropic_completion_and_json_contract),
    ("Anthropic failures use the existing deterministic fallback", check_anthropic_errors_use_existing_fallback),
    ("injected speech ignores unused provider settings and SDKs", check_injected_speech_ignores_unused_provider_configuration),
    ("shutdown settles late voice work before closing shared clients", check_shutdown_settles_late_voice_tasks_before_clients_close),
    ("optional LLM closure forwards once through fallback wrappers", check_optional_llm_client_closure_is_forwarded_once),
    ("expressive TTS socket handshake, MP3 chunks, and safe failures", check_expressive_tts_socket_transport_offline),
]
