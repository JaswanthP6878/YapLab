"""Concrete personas and room presets.

Defines the distinct AI students described in the README and a way to compose
a room of 5-12 listeners from a named preset.
"""

from __future__ import annotations

from .models import Persona

# --- Persona definitions ---------------------------------------------------
# Biases are additive points applied to the raw model attention/confusion.
# question_propensity in 0..1 controls how often the persona raises a hand.

CONFUSED_FIRST_YEAR = Persona(
    name="confused first-year",
    description=(
        "A first-year student new to the material. Loses the thread easily "
        "and asks a lot of clarifying questions."
    ),
    attention_bias=-5.0,
    confusion_bias=+20.0,
    question_propensity=0.8,
)

SKEPTICAL_PROFESSOR = Persona(
    name="skeptical professor",
    description=(
        "A senior academic who follows closely but challenges unsupported "
        "claims and imprecise language."
    ),
    attention_bias=+10.0,
    confusion_bias=-10.0,
    question_propensity=0.7,
)

ESL_STUDENT = Persona(
    name="ESL student",
    description=(
        "A capable student for whom English is a second language. Pays close "
        "attention but trips on jargon and fast speech."
    ),
    attention_bias=+5.0,
    confusion_bias=+10.0,
    question_propensity=0.5,
)

DISTRACTED_STUDENT = Persona(
    name="distracted student",
    description=(
        "A student whose attention drifts, especially when the talk rambles. "
        "Rarely asks questions."
    ),
    attention_bias=-20.0,
    confusion_bias=+5.0,
    question_propensity=0.2,
)

DOMAIN_EXPERT = Persona(
    name="domain expert",
    description=(
        "An expert in the field. Follows effortlessly and asks sharp, "
        "pointed questions about the details."
    ),
    attention_bias=+15.0,
    confusion_bias=-20.0,
    question_propensity=0.6,
)

ENGAGED_STUDENT = Persona(
    name="engaged student",
    description=(
        "A motivated student who stays focused and asks thoughtful questions "
        "at a moderate rate."
    ),
    attention_bias=+8.0,
    confusion_bias=0.0,
    question_propensity=0.5,
)

ALL_PERSONAS: list[Persona] = [
    CONFUSED_FIRST_YEAR,
    SKEPTICAL_PROFESSOR,
    ESL_STUDENT,
    DISTRACTED_STUDENT,
    DOMAIN_EXPERT,
    ENGAGED_STUDENT,
]

# --- Room presets ----------------------------------------------------------
# Each preset must compose between 5 and 12 listeners.

ROOM_PRESETS: dict[str, list[Persona]] = {
    "default": [
        CONFUSED_FIRST_YEAR,
        SKEPTICAL_PROFESSOR,
        ESL_STUDENT,
        DISTRACTED_STUDENT,
        DOMAIN_EXPERT,
    ],
    "full_room": [
        CONFUSED_FIRST_YEAR,
        SKEPTICAL_PROFESSOR,
        ESL_STUDENT,
        DISTRACTED_STUDENT,
        DOMAIN_EXPERT,
        ENGAGED_STUDENT,
        CONFUSED_FIRST_YEAR,
        ENGAGED_STUDENT,
    ],
    "lecture_hall": [
        CONFUSED_FIRST_YEAR,
        CONFUSED_FIRST_YEAR,
        ESL_STUDENT,
        ESL_STUDENT,
        DISTRACTED_STUDENT,
        DISTRACTED_STUDENT,
        ENGAGED_STUDENT,
        ENGAGED_STUDENT,
        SKEPTICAL_PROFESSOR,
        DOMAIN_EXPERT,
    ],
}

MIN_ROOM_SIZE = 5
MAX_ROOM_SIZE = 12


def build_room(preset: str) -> list[tuple[str, Persona]]:
    """Build a room as a list of ``(listener_id, Persona)`` from a preset.

    Listener ids are distinct and stable (``L0``, ``L1``, ...). Raises
    ``ValueError`` for an unknown preset or an out-of-range room size.
    """
    if preset not in ROOM_PRESETS:
        raise ValueError(f"unknown room preset: {preset!r}")
    personas = ROOM_PRESETS[preset]
    size = len(personas)
    if size < MIN_ROOM_SIZE or size > MAX_ROOM_SIZE:
        raise ValueError(
            f"room preset {preset!r} composes {size} listeners; must be "
            f"between {MIN_ROOM_SIZE} and {MAX_ROOM_SIZE} inclusive"
        )
    return [(f"L{i}", persona) for i, persona in enumerate(personas)]
