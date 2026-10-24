"""Configuration for the FrontRow backend.

All tunables live here as a single immutable-ish ``Config`` object that is
passed by dependency injection into the orchestrator, moderator, and agents.
Values can be loaded from the environment with sensible fallbacks via
``Config.from_env``.
"""

from __future__ import annotations

import os
from pathlib import Path

from pydantic import BaseModel, Field, model_validator

# The repo-root .env (front_row/.env), copied from .env.example.
ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


def load_env_file(path: Path = ENV_FILE) -> bool:
    """Load ``path`` into the environment if it exists.

    Variables already set in the real environment win over the file, so a
    one-off ``FRONTROW_LLM=fake uv run ...`` still works. Returns whether a
    file was loaded.
    """
    from dotenv import load_dotenv

    return path.is_file() and load_dotenv(path, override=False)


def _env_float(name: str, default: float) -> float:
    """Read a float from the environment, falling back to ``default``."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    """Read an int from the environment, falling back to ``default``."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_str(name: str, default: str) -> str:
    """Read a string from the environment, falling back to ``default``."""
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw


def _default_model() -> str:
    """Default model for the provider named by ``FRONTROW_LLM``."""
    from .llm.openai_client import PROVIDERS

    provider = PROVIDERS.get(_env_str("FRONTROW_LLM", "fake"))
    return provider.default_model if provider else "gpt-4o-mini"


class Config(BaseModel):
    """Runtime configuration for a FrontRow session.

    The defaults match the product spec. ``per_listener_timeout_seconds`` must
    be strictly less than ``tick_interval_seconds`` so a slow listener can be
    excluded before the next tick is due.
    """

    model_config = {"frozen": False, "extra": "allow"}

    tick_interval_seconds: float = Field(default=15.0, ge=1.0, le=300.0)
    per_listener_timeout_seconds: float = Field(default=10.0, gt=0)
    transcript_window_seconds: float = Field(default=30.0, gt=0)

    llm_model: str = Field(default="gpt-4o-mini")
    llm_timeout_seconds: float = Field(default=30.0, gt=0)

    moderator_min_interruption_gap_seconds: float = Field(default=60.0, ge=0)

    grounding_min_span_chars: int = Field(default=10, ge=1)

    # How many of a listener's most recent reactions are fed back into its
    # prompt, so attention and confusion carry over between ticks.
    listener_memory_ticks: int = Field(default=3, ge=0)

    # How many of a listener's own earlier questions (and what happened to
    # them) are fed back into its prompt, so it does not repeat itself.
    listener_question_memory: int = Field(default=5, ge=0)

    # Upper bound on the rolling talk summary shared with every listener.
    talk_summary_max_chars: int = Field(default=1200, ge=100)

    # A raised hand the presenter has not called on within this many seconds
    # is lowered and its question moves to the Q&A pool.
    hand_raise_timeout_seconds: float = Field(default=45.0, gt=0)

    # Safety net for echo suppression: if the frontend never reports that an
    # agent's question audio finished, stop discarding mic input after this.
    playback_max_seconds: float = Field(default=30.0, gt=0)

    # Maximum number of pooled questions asked in the Q&A phase.
    qa_max_questions: int = Field(default=5, ge=0)

    @model_validator(mode="after")
    def _check_timeout_below_interval(self) -> "Config":
        if self.per_listener_timeout_seconds >= self.tick_interval_seconds:
            raise ValueError(
                "per_listener_timeout_seconds "
                f"({self.per_listener_timeout_seconds}) must be strictly less "
                f"than tick_interval_seconds ({self.tick_interval_seconds})"
            )
        return self

    @classmethod
    def from_env(cls, **overrides: object) -> "Config":
        """Build a Config from environment variables with fallbacks.

        Explicit ``overrides`` take precedence over environment values.
        """
        values: dict[str, object] = {
            "tick_interval_seconds": _env_float(
                "FRONTROW_TICK_INTERVAL_SECONDS", 15.0
            ),
            "per_listener_timeout_seconds": _env_float(
                "FRONTROW_PER_LISTENER_TIMEOUT_SECONDS", 10.0
            ),
            "transcript_window_seconds": _env_float(
                "FRONTROW_TRANSCRIPT_WINDOW_SECONDS", 30.0
            ),
            "llm_model": _env_str("FRONTROW_LLM_MODEL", _default_model()),
            "llm_timeout_seconds": _env_float("FRONTROW_LLM_TIMEOUT_SECONDS", 30.0),
            "moderator_min_interruption_gap_seconds": _env_float(
                "FRONTROW_MODERATOR_GAP_SECONDS", 60.0
            ),
            "grounding_min_span_chars": _env_int(
                "FRONTROW_GROUNDING_MIN_SPAN_CHARS", 10
            ),
        }
        values.update(overrides)
        return cls(**values)
