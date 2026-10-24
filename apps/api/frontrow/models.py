"""Pydantic v2 domain models for FrontRow.

These are the data structures that flow through the orchestration core:
slides, transcript chunks, personas, reactions, grounded questions, hand
raises, timeline events, and the session lifecycle enum.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


def clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    """Clamp ``value`` into the inclusive range ``[low, high]``."""
    return max(low, min(high, value))


class SessionState(str, Enum):
    """Lifecycle state of a session."""

    IDLE = "idle"
    PRESENTING = "presenting"
    QA = "qa"
    REPORTING = "reporting"
    ENDED = "ended"


# Permitted forward transitions, kept here so the server layer (later) can
# reuse the same rules the spec defines.
PERMITTED_TRANSITIONS: dict[SessionState, SessionState] = {
    SessionState.IDLE: SessionState.PRESENTING,
    SessionState.PRESENTING: SessionState.QA,
    SessionState.QA: SessionState.REPORTING,
    SessionState.REPORTING: SessionState.ENDED,
}


class Slide(BaseModel):
    """One page of the uploaded presentation."""

    model_config = {"extra": "allow"}

    index: int = Field(ge=0)
    text: str = ""


class TranscriptChunk(BaseModel):
    """A single unit of recognized speech text with timing."""

    model_config = {"extra": "allow"}

    start: float
    end: float
    text: str

    @model_validator(mode="after")
    def _check_time_order(self) -> "TranscriptChunk":
        if self.end < self.start:
            raise ValueError(
                f"TranscriptChunk end ({self.end}) cannot be earlier than "
                f"start ({self.start})"
            )
        return self


class Persona(BaseModel):
    """A named definition of a listener's disposition and behavior.

    Biases are additive adjustments in points applied to the raw model
    attention/confusion values. ``question_propensity`` in 0..1 influences how
    likely the persona is to ask a question.
    """

    model_config = {"extra": "allow"}

    name: str
    description: str = ""
    attention_bias: float = 0.0
    confusion_bias: float = 0.0
    question_propensity: float = Field(default=0.5, ge=0.0, le=1.0)


class Reaction(BaseModel):
    """A listener's response for a single tick."""

    model_config = {"extra": "allow"}

    listener_id: str
    attention: float = Field(ge=0.0, le=100.0)
    confusion: float = Field(ge=0.0, le=100.0)
    understood: str = ""
    question: str | None = None
    # Index of the slide on screen when the listener reacted, if known.
    slide: int | None = None

    @field_validator("attention", "confusion", mode="before")
    @classmethod
    def _clamp_ranges(cls, v: float) -> float:
        try:
            return clamp(float(v))
        except (TypeError, ValueError):
            return 0.0


class GroundedQuestion(BaseModel):
    """A question that has been verified to quote real content.

    ``source`` is either ``"transcript"`` or ``"slide:<index>"``.
    """

    model_config = {"extra": "allow"}

    question: str
    quote: str
    source: str


class HandRaise(BaseModel):
    """A record that a listener has a grounded question available to ask.

    ``confusion`` and ``tick`` capture the listener's state when the question
    was raised so the moderator can rank questions. ``follow_up_of`` links a
    follow-up to the question whose answer prompted it.
    """

    model_config = {"extra": "allow"}

    listener_id: str
    question: GroundedQuestion
    question_id: str = ""
    persona: str = ""
    confusion: float = 0.0
    tick: int = 0
    slide: int | None = None
    follow_up_of: str | None = None


Verdict = Literal["answered", "partial", "dodged"]


class AnswerVerdict(BaseModel):
    """The asking listener's judgement of the presenter's answer."""

    model_config = {"extra": "allow"}

    question_id: str
    listener_id: str
    verdict: Verdict
    comment: str = ""
    follow_up: GroundedQuestion | None = None


class TimelineEvent(BaseModel):
    """A single timestamped event emitted by the orchestration core."""

    model_config = {"extra": "allow"}

    type: str
    t: float
    data: dict = Field(default_factory=dict)
