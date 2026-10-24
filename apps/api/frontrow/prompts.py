"""Prompt construction for listener reactions and answer evaluation.

Kept separate so prompts are easy to extend and so the deterministic FakeLLM
can find the markers and source text it needs to produce grounded output.
"""

from __future__ import annotations

from .llm.fake import (
    ANSWER_BEGIN,
    ANSWER_END,
    ANSWER_MARKER,
    NEW_SPEECH_BEGIN,
    NEW_SPEECH_END,
    NO_SUMMARY_YET,
    PERSONA_MARKER,
    PREVIOUS_SUMMARY_BEGIN,
    PREVIOUS_SUMMARY_END,
    PROPENSITY_MARKER,
    REACTION_MARKER,
    SOURCE_BEGIN,
    SOURCE_END,
    SUMMARY_MARKER,
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
    "\n\nReal students hold their questions while a speaker is "
    "introducing a topic or previewing what comes next. Never ask about "
    "something the presenter has not explained yet, including slide text "
    "they have not talked about; ask only when something they actually "
    "explained left you unsure. Most of the time, do not ask."
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


SUMMARY_SYSTEM = (
    "You keep running notes on a live presentation for an audience of "
    "students. Respond ONLY with a JSON object: {\"summary\": \"...\"}. "
    "Update the previous notes with the new speech: keep, in order, the "
    "topics covered, the key claims, definitions, and numbers the presenter "
    "stated, and anything they promised to explain later. Under 150 words. "
    f"{SUMMARY_MARKER}"
)


def _question_lines(questions: list[dict[str, str]]) -> str:
    """List the listener's own earlier questions and what happened to them."""
    if not questions:
        return ""
    lines = [f'- "{q["question"]}" ({q["status"]})' for q in questions]
    return (
        "Questions you already raised. Do not ask these again; only ask "
        "something new, or follow up if an answer left you unsatisfied.\n"
        + "\n".join(lines)
        + "\n\n"
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
    questions: list[dict[str, str]] | None = None,
    talk_summary: str = "",
    talk_elapsed_seconds: float | None = None,
) -> tuple[str, str]:
    """Build ``(system, user)`` prompts for a reaction request.

    The user prompt embeds machine-readable markers (persona name, question
    propensity, and a delimited block of quotable source text) so the
    deterministic FakeLLM can produce real grounded output, while remaining a
    perfectly reasonable prompt for a real model. Slides up to and including
    ``current_slide`` are shown, with the current one marked as on screen.
    ``talk_summary`` covers the whole talk so far, beyond the recent window,
    and ``questions`` are the listener's own earlier questions.
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

    progress = (
        f"The presenter has been speaking for {max(0.0, talk_elapsed_seconds):.0f} seconds.\n\n"
        if talk_elapsed_seconds is not None
        else ""
    )

    user = (
        f"{PERSONA_MARKER} {persona.name}\n"
        f"Persona: {persona.description}\n"
        f"{PROPENSITY_MARKER} {persona.question_propensity}\n\n"
        f"{progress}"
        f"{_memory_lines(memory or [])}\n\n"
        f"{_question_lines(questions or [])}"
        + (f"The talk so far, in brief: {talk_summary}\n\n" if talk_summary else "")
        + "Here is the most recent part of the talk (and slides shown so far). "
        "React as your persona would.\n\n"
        f"{SOURCE_BEGIN}\n{source_text}\n{SOURCE_END}\n"
    )
    return REACTION_SYSTEM, user


def build_summary_prompt(previous: str, new_speech: str) -> tuple[str, str]:
    """Build ``(system, user)`` prompts to fold new speech into the talk notes."""
    user = (
        "Previous notes:\n"
        f"{PREVIOUS_SUMMARY_BEGIN}\n{previous or NO_SUMMARY_YET}\n{PREVIOUS_SUMMARY_END}\n\n"
        "New speech since then:\n"
        f"{NEW_SPEECH_BEGIN}\n{new_speech}\n{NEW_SPEECH_END}\n"
    )
    return SUMMARY_SYSTEM, user


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
