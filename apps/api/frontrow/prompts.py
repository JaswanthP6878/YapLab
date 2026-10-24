"""Prompt construction for listener reactions and answer evaluation.

Kept separate so prompts are easy to extend and so the deterministic FakeLLM
can find the markers and source text it needs to produce grounded output.
"""

from __future__ import annotations

from .llm.fake import (
    ANSWER_BEGIN,
    ANSWER_END,
    ANSWER_MARKER,
    PERSONA_MARKER,
    PROPENSITY_MARKER,
    REACTION_MARKER,
    SOURCE_BEGIN,
    SOURCE_END,
)
from .models import Persona, Reaction, Slide

REACTION_SYSTEM = (
    "You are an AI student listening to a live presentation. "
    "Respond ONLY with a JSON object containing: attention (0-100), "
    "confusion (0-100), understood (short string), and optionally question "
    "and quote. 'question' is what you would say out loud when called on: "
    "one short, natural spoken sentence (under 25 words) that does not read "
    "out the quote. 'quote' MUST be an exact contiguous substring of the "
    "transcript or slide text you were given, showing what prompted the "
    "question. Only ask when your persona genuinely would. "
    f"{REACTION_MARKER}"
)

ANSWER_SYSTEM = (
    "You are an AI student who asked the presenter a question and has just "
    "heard their answer. Respond ONLY with a JSON object containing: verdict "
    "(one of \"answered\", \"partial\", \"dodged\"), comment (one short "
    "sentence on why), and optionally follow_up and quote. Ask a follow_up "
    "only if the answer left your question partly open; 'quote' MUST then be "
    "an exact contiguous substring of the presenter's answer. "
    f"{ANSWER_MARKER}"
)


def _memory_lines(memory: list[Reaction]) -> str:
    """Summarize a listener's recent reactions for its prompt."""
    if not memory:
        return "This is the first stretch of the talk you have heard."
    lines = [
        f"- attention {r.attention:.0f}, confusion {r.confusion:.0f}: {r.understood}"
        for r in memory
    ]
    return (
        "How you felt over the last few stretches (oldest first). Stay "
        "consistent: attention drifts gradually unless something changes.\n"
        + "\n".join(lines)
    )


def build_reaction_prompt(
    persona: Persona,
    window_text: str,
    slides: list[Slide] | None,
    *,
    current_slide: int | None = None,
    memory: list[Reaction] | None = None,
) -> tuple[str, str]:
    """Build ``(system, user)`` prompts for a reaction request.

    The user prompt embeds machine-readable markers (persona name, question
    propensity, and a delimited block of quotable source text) so the
    deterministic FakeLLM can produce real grounded output, while remaining a
    perfectly reasonable prompt for a real model. Slides up to and including
    ``current_slide`` are shown, with the current one marked as on screen.
    """
    visible = [
        s
        for s in (slides or [])
        if s.text and (current_slide is None or s.index <= current_slide)
    ]
    slide_text = "\n".join(
        f"[slide {s.index}{' (on screen)' if s.index == current_slide else ''}] {s.text}"
        for s in visible
    )
    source_text = window_text
    if slide_text:
        source_text = f"{window_text}\n{slide_text}".strip()

    user = (
        f"{PERSONA_MARKER} {persona.name}\n"
        f"Persona: {persona.description}\n"
        f"{PROPENSITY_MARKER} {persona.question_propensity}\n\n"
        f"{_memory_lines(memory or [])}\n\n"
        "Here is the most recent part of the talk (and slides shown so far). "
        "React as your persona would.\n\n"
        f"{SOURCE_BEGIN}\n{source_text}\n{SOURCE_END}\n"
    )
    return REACTION_SYSTEM, user


def build_answer_prompt(
    persona: Persona, question: str, quote: str, answer_text: str
) -> tuple[str, str]:
    """Build ``(system, user)`` prompts asking a listener to judge an answer."""
    user = (
        f"{PERSONA_MARKER} {persona.name}\n"
        f"Persona: {persona.description}\n"
        f"{PROPENSITY_MARKER} {persona.question_propensity}\n\n"
        f"You asked: {question}\n"
        f"It was about: \"{quote}\"\n\n"
        "The presenter answered:\n"
        f"{ANSWER_BEGIN}\n{answer_text}\n{ANSWER_END}\n"
    )
    return ANSWER_SYSTEM, user
