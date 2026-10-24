"""Listener agent: one AI student.

Each :class:`Listener` holds a persona, an LLM client, and per-agent memory.
Its :meth:`react` method turns a transcript window into a :class:`Reaction`,
applying persona trait adjustments and dropping any question that fails
grounding.
"""

from __future__ import annotations

from .clock import Clock
from .grounding import check_grounding, validate_question_payload
from .llm.base import LLMClient
from .models import (
    AnswerVerdict,
    GroundedQuestion,
    HandRaise,
    Persona,
    Reaction,
    Slide,
    clamp,
)
from .prompts import build_answer_prompt, build_reaction_prompt

_VERDICTS = ("answered", "partial", "dodged")


def _as_score(value: object, default: float) -> float:
    """Coerce a model-supplied score to a float, tolerating junk.

    Accepts numbers and numeric strings (``"75"``, ``"75%"``); anything else
    (``None``, ``"high"``, lists) falls back to ``default`` rather than
    discarding the whole reaction.
    """
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip().rstrip("%"))
        except ValueError:
            return default
    return default


class Listener:
    """One AI student participant."""

    def __init__(
        self,
        listener_id: str,
        persona: Persona,
        llm: LLMClient,
    ) -> None:
        self.listener_id = listener_id
        self.persona = persona
        self.llm = llm
        # Per-agent memory: list of (window_text, Reaction).
        self.memory: list[tuple[str, Reaction]] = []
        # The grounded question produced on the most recent react() call, if
        # any. The orchestrator reads this to build hand raises.
        self.last_grounded_question: GroundedQuestion | None = None
        # A question from the most recent react() call that failed grounding,
        # as ``(question, quote)``, so the orchestrator can record it.
        self.last_rejected_question: tuple[str, str] | None = None
        # Questions this listener raised, oldest first, as
        # ``{"id", "question", "status"}``; fed back into its prompt so it
        # does not repeat itself and knows which answers fell short.
        self.questions: list[dict[str, str]] = []

    def note_question(self, question_id: str, question: str, status: str) -> None:
        """Remember a question this listener raised."""
        self.questions.append({"id": question_id, "question": question, "status": status})

    def update_question(self, question_id: str, status: str) -> None:
        """Update what happened to one of this listener's questions."""
        for q in self.questions:
            if q["id"] == question_id:
                q["status"] = status

    async def react(
        self,
        window_text: str,
        slides: list[Slide] | None,
        *,
        model: str,
        timeout: float,
        clock: Clock,
        grounding_min_chars: int = 10,
        current_slide: int | None = None,
        memory_ticks: int = 3,
        talk_summary: str = "",
        question_memory: int = 5,
    ) -> Reaction | None:
        """Produce a :class:`Reaction` for the given transcript window.

        The listener's last ``memory_ticks`` reactions are included in the
        prompt so its attention and confusion carry over between ticks, along
        with its last ``question_memory`` questions and what happened to them,
        and ``talk_summary`` (notes on the whole talk so far).

        ``clock`` is accepted for interface symmetry and future use (e.g.
        think-time simulation); the actual LLM timeout is enforced by the
        orchestrator which races this coroutine against the clock.
        """
        self.last_grounded_question = None
        self.last_rejected_question = None

        recent = [r for _, r in self.memory[-memory_ticks:]] if memory_ticks else []
        system, user = build_reaction_prompt(
            self.persona,
            window_text,
            slides,
            current_slide=current_slide,
            memory=recent,
            questions=self.questions[-question_memory:] if question_memory else [],
            talk_summary=talk_summary,
        )
        payload = await self.llm.complete_json(
            system, user, model=model, timeout=timeout
        )

        raw_attention = _as_score(payload.get("attention"), 50.0)
        raw_confusion = _as_score(payload.get("confusion"), 50.0)
        understood = str(payload.get("understood") or "")

        # Apply persona trait adjustments, then clamp.
        attention = clamp(raw_attention + self.persona.attention_bias)
        confusion = clamp(raw_confusion + self.persona.confusion_bias)

        question_text: str | None = None
        if payload.get("question"):
            grounded = validate_question_payload(
                payload,
                transcript_text=window_text,
                slides=slides,
                min_chars=grounding_min_chars,
            )
            if grounded is not None:
                question_text = grounded.question
                self.last_grounded_question = grounded
            else:
                # Grounding failed: drop the question but keep the reaction.
                self.last_rejected_question = (
                    str(payload.get("question")),
                    str(payload.get("quote") or ""),
                )

        reaction = Reaction(
            listener_id=self.listener_id,
            attention=attention,
            confusion=confusion,
            understood=understood,
            question=question_text,
            slide=current_slide,
        )

        self.memory.append((window_text, reaction))
        return reaction

    async def evaluate_answer(
        self,
        hand: HandRaise,
        answer_text: str,
        *,
        model: str,
        timeout: float,
        grounding_min_chars: int = 10,
    ) -> AnswerVerdict:
        """Judge the presenter's answer to this listener's question.

        A follow-up question is kept only if it quotes the answer itself.
        An empty answer is judged ``dodged`` without calling the model.
        """
        if not answer_text.strip():
            return AnswerVerdict(
                question_id=hand.question_id,
                listener_id=self.listener_id,
                verdict="dodged",
                comment="No answer was given.",
            )
        system, user = build_answer_prompt(
            self.persona, hand.question.question, hand.question.quote, answer_text
        )
        payload = await self.llm.complete_json(
            system, user, model=model, timeout=timeout
        )
        verdict = str(payload.get("verdict", "")).strip().lower()
        if verdict not in _VERDICTS:
            verdict = "partial"
        follow_up = None
        if payload.get("follow_up") and payload.get("quote"):
            grounded = check_grounding(
                str(payload["follow_up"]),
                str(payload["quote"]),
                answer_text,
                None,
                grounding_min_chars,
            )
            if grounded is not None:
                follow_up = grounded.model_copy(update={"source": "answer"})
        return AnswerVerdict(
            question_id=hand.question_id,
            listener_id=self.listener_id,
            verdict=verdict,
            comment=str(payload.get("comment") or ""),
            follow_up=follow_up,
        )
