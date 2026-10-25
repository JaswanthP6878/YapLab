#!/usr/bin/env python3
"""Run the sample talk through the orchestrator and print the room score.

Shortcut for ``python -m frontrow.replay``; takes the same options.

Offline (default, deterministic):

    cd apps/api
    uv run python demo.py --print-timeline

Live, using DeepSeek (needs DEEPSEEK_API_KEY in the environment):

    uv run --extra openai python demo.py --llm deepseek     # default model deepseek-flash
    uv run --extra openai python demo.py --llm deepseek --model deepseek-v4-pro

Nebius Nemotron (fast listeners/summary, reasoning answer grading):

    uv run --extra openai python demo.py --llm nebius --stats-out /tmp/nebius-replay.json
"""

from frontrow.replay import main

if __name__ == "__main__":
    main()
