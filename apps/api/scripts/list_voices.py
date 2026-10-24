"""List accessible ElevenLabs voices and age/gender/accent labels.

API: https://elevenlabs.io/docs/api-reference/voices/search
Run from apps/api: uv run python scripts/list_voices.py --json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path


async def list_voices(as_json: bool = False) -> list[dict]:
    try:
        import httpx
        from dotenv import load_dotenv
        from elevenlabs.client import AsyncElevenLabs
    except ImportError:
        raise RuntimeError("Install speech dependencies with uv sync --extra elevenlabs.") from None
    load_dotenv(Path(__file__).resolve().parents[3] / ".env")
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        raise RuntimeError("ELEVENLABS_API_KEY is not set in the repository-root .env.")
    voices = []
    async with httpx.AsyncClient(timeout=30) as http_client:
        client = AsyncElevenLabs(api_key=key, httpx_client=http_client)
        token = None
        seen_tokens = set()
        while True:
            page = await client.voices.search(page_size=100, next_page_token=token)
            voices.extend({
                "id": voice.voice_id,
                "name": voice.name,
                "labels": voice.labels or {},
                "description": voice.description or "",
            } for voice in page.voices)
            if not page.has_more:
                break
            token = page.next_page_token
            if not token or token in seen_tokens:
                raise RuntimeError("The voice catalog returned invalid pagination.")
            seen_tokens.add(token)
    if as_json:
        print(json.dumps(voices, indent=2))
    else:
        for voice in voices:
            labels = ", ".join(f"{name}={value}" for name, value in sorted(voice["labels"].items()))
            print(f"{voice['id']}\t{voice['name']}\t{labels}")
    return voices


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="Print the voice catalog as JSON.")
    args = parser.parse_args()
    try:
        asyncio.run(list_voices(args.json))
    except RuntimeError as error:
        # Only our known configuration/pagination errors may be shown verbatim.
        if str(error).startswith(("Install speech", "ELEVENLABS_API_KEY", "The voice catalog")):
            parser.exit(2, f"{error}\n")
        parser.exit(2, "Could not list voices. Check the key, permissions, and network.\n")
    except Exception:
        parser.exit(2, "Could not list voices. Check the key, permissions, and network.\n")


if __name__ == "__main__":
    main()
