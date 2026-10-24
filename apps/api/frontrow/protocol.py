"""Wire protocol between the browser and the backend.

Client -> server messages on the session WebSocket are a tagged union on
``type``. Every client message may carry an ``id``; the server answers each
one with an ``ack`` or ``error`` echoing that ``id``. Everything that happens
in the session is streamed as ``event`` messages wrapping timeline events.

Export the JSON schema for the frontend with::

    uv run python -m frontrow.protocol > ../../packages/protocol/schema.json
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter

from .models import Slide

MessageId = Union[str, int, None]


# --- client -> server (WebSocket) -------------------------------------------


class _ClientMessage(BaseModel):
    model_config = {"extra": "forbid"}

    id: MessageId = Field(default=None, description="Echoed back in the ack/error.")


class StartMessage(_ClientMessage):
    """Idle -> presenting. Starts the listeners' tick loop."""

    type: Literal["start"]


class TranscriptMessage(_ClientMessage):
    """One FINAL speech-to-text segment (never partials)."""

    type: Literal["transcript"]
    seq: int = Field(ge=0, description="Increasing per session; resends are ignored.")
    text: str
    duration: float | None = Field(
        default=None, ge=0, description="Spoken length in seconds, if known."
    )


class SlideMessage(_ClientMessage):
    """The presenter moved to slide ``index`` (zero-based)."""

    type: Literal["slide"]
    index: int = Field(ge=0)


class TakeQuestionMessage(_ClientMessage):
    """The presenter calls on a raised (or pooled) question during the talk."""

    type: Literal["take_question"]
    question_id: str


class PlaybackStartedMessage(_ClientMessage):
    """Question audio started playing; the backend ignores mic input until ended."""

    type: Literal["playback_started"]
    question_id: str


class PlaybackEndedMessage(_ClientMessage):
    """Question audio finished playing."""

    type: Literal["playback_ended"]
    question_id: str


class AnswerDoneMessage(_ClientMessage):
    """The presenter finished answering; the asking listener judges the answer."""

    type: Literal["answer_done"]
    question_id: str


class EndPresentingMessage(_ClientMessage):
    """Presenting -> Q&A."""

    type: Literal["end_presenting"]


class NextQuestionMessage(_ClientMessage):
    """Q&A: close the current answer and ask the next question."""

    type: Literal["next_question"]


class EndQAMessage(_ClientMessage):
    """Q&A -> reporting."""

    type: Literal["end_qa"]


class FinishMessage(_ClientMessage):
    """Reporting -> ended."""

    type: Literal["finish"]


class PingMessage(_ClientMessage):
    type: Literal["ping"]


ClientMessage = Annotated[
    Union[
        StartMessage,
        TranscriptMessage,
        SlideMessage,
        TakeQuestionMessage,
        PlaybackStartedMessage,
        PlaybackEndedMessage,
        AnswerDoneMessage,
        EndPresentingMessage,
        NextQuestionMessage,
        EndQAMessage,
        FinishMessage,
        PingMessage,
    ],
    Field(discriminator="type"),
]
client_message_adapter: TypeAdapter[Any] = TypeAdapter(ClientMessage)


# --- shared shapes ------------------------------------------------------------


class ListenerInfo(BaseModel):
    id: str
    persona: str


class SessionInfo(BaseModel):
    id: str
    state: str
    preset: str
    current_slide: int | None
    listeners: list[ListenerInfo]
    slides: list[Slide]


class CreateSessionRequest(BaseModel):
    """``POST /sessions`` body (slides as text; use /sessions/upload for a PDF)."""

    model_config = {"extra": "forbid"}

    preset: str = "default"
    slides: list[Slide] = Field(default_factory=list)
    tick_interval_seconds: float | None = Field(
        default=None, description="Override the 15s default (1-300), e.g. for testing."
    )


# --- server -> client (WebSocket) -------------------------------------------


class EventOut(BaseModel):
    """One timeline event. ``event`` names it; ``t`` is session-clock seconds."""

    type: Literal["event"] = "event"
    event: str
    t: float
    data: dict[str, Any]


class HelloMessage(BaseModel):
    """First message after connecting. ``events`` is the backlog if ?replay=1."""

    type: Literal["hello"] = "hello"
    session: SessionInfo
    events: list[EventOut] = Field(default_factory=list)


class AckMessage(BaseModel):
    type: Literal["ack"] = "ack"
    id: MessageId = None
    request: str
    result: dict[str, Any] = Field(default_factory=dict)


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    id: MessageId = None
    request: str | None = None
    message: str
    detail: list[dict[str, Any]] | None = None


ServerMessage = Annotated[
    Union[HelloMessage, EventOut, AckMessage, ErrorMessage],
    Field(discriminator="type"),
]


def json_schema() -> dict[str, Any]:
    """JSON schema for both directions plus the REST request/response shapes."""
    defs: dict[str, Any] = {}
    out: dict[str, Any] = {"title": "FrontRow protocol", "$defs": defs}
    for name, tp in (
        ("ClientMessage", ClientMessage),
        ("ServerMessage", ServerMessage),
        ("CreateSessionRequest", CreateSessionRequest),
        ("SessionInfo", SessionInfo),
    ):
        schema = TypeAdapter(tp).json_schema(ref_template="#/$defs/{model}")
        defs.update(schema.pop("$defs", {}))
        defs[name] = schema
    return out


if __name__ == "__main__":
    print(json.dumps(json_schema(), indent=2))
