#!/usr/bin/env python3
"""Run the sample talk through the orchestrator and print the room score.

Shortcut for ``python -m frontrow.replay``; takes the same options.

Offline (default, deterministic):

    cd apps/api
    uv run python demo.py --print-timeline

Live, using the real OpenAI API (needs OPENAI_API_KEY in the environment):

    uv run --extra openai python demo.py --llm openai --model gpt-4o-mini
"""

from frontrow.replay import main

if __name__ == "__main__":
    main()
