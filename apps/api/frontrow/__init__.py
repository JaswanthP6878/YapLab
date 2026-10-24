"""FrontRow backend: a practice classroom full of AI students.

This package contains the orchestration core: session models, a swappable
clock, a time-windowed transcript buffer, LLM client abstractions (with a
deterministic fake), persona-driven listener agents, grounding, a moderator,
and the tick-loop orchestrator.
"""

from .config import load_env_file

__version__ = "0.1.0"

# Every entry point (server, replay, demo, fake client) imports this package
# first, so the repo-root .env is loaded before anything reads the environment.
load_env_file()
