"""A stand-in browser: plays a scripted talk against a running server.

Does exactly what the frontend will do, over real HTTP and WebSocket: creates
a session, sends slide changes and final transcript segments in real time,
optionally calls on raised hands, runs Q&A with the scenario's scripted
answers, and prints the report. Use it to see the live event stream without
a frontend, or as a reference for the message flow.

    # terminal 1
    uv run uvicorn frontrow.server:app
    # terminal 2
    uv run python -m frontrow.fake_client --tick 5 --speed 2 --take-hands
"""

from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import urllib.request
from pathlib import Path
from typing import Any

import websockets

from .replay import DEFAULT_SCENARIO, load_scenario

_QUIET_EVENTS = {"reaction", "tick_start", "transcript"}


def _http(method: str, url: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url, data=data, method=method, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:  # noqa: S310 - local dev tool
        return json.loads(resp.read())


class Client:
    """Request/ack correlation over one WebSocket, plus an event printer."""

    def __init__(self, ws: Any, verbose: bool) -> None:
        self.ws = ws
        self.verbose = verbose
        self._ids = itertools.count(1)
        self._pending: dict[int, asyncio.Future[dict[str, Any]]] = {}
        self.raised: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    async def request(self, type_: str, **fields: Any) -> dict[str, Any]:
        msg_id = next(self._ids)
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._pending[msg_id] = fut
        await self.ws.send(json.dumps({"type": type_, "id": msg_id, **fields}))
        reply = await fut
        if reply["type"] == "error":
            print(f"  !! {type_}: {reply['message']}")
        return reply

    async def read(self) -> None:
        async for raw in self.ws:
            msg = json.loads(raw)
            if msg["type"] in ("ack", "error") and msg.get("id") in self._pending:
                self._pending.pop(msg["id"]).set_result(msg)
            elif msg["type"] == "event":
                self._print(msg)
                if msg["event"] == "hand_raised":
                    self.raised.put_nowait(msg["data"])
            elif msg["type"] == "hello":
                s = msg["session"]
                print(f"connected: session {s['id']} ({s['state']}), "
                      f"{len(s['listeners'])} listeners, {len(s['slides'])} slides")

    def _print(self, msg: dict[str, Any]) -> None:
        name, d = msg["event"], msg["data"]
        if name in _QUIET_EVENTS and not self.verbose:
            return
        if name == "tick_complete":
            room = d["room"]
            detail = (f"tick {d['tick']}: attention {room['attention']}, "
                      f"confusion {room['confusion']}, comprehension {room['comprehension']}")
        elif name in ("hand_raised", "qa_question", "question_taken", "hand_lowered", "pooled"):
            detail = f"{d['question_id']} [{d['listener']} {d['persona']}] {d['question']}"
        elif name == "answer_verdict":
            detail = f"{d['question_id']} {d['verdict']}: {d['comment']}"
        else:
            detail = json.dumps(d)
        print(f"  t={msg['t']:6.1f}  {name:16s} {detail}")


async def _answer(client: Client, seq: int, question_id: str, text: str) -> None:
    """What the frontend does when a question is asked aloud and answered."""
    await client.request("playback_started", question_id=question_id)
    await asyncio.sleep(0.5)  # the question audio playing
    await client.request("playback_ended", question_id=question_id)
    if text:
        await client.request("transcript", seq=seq, text=text)


async def run(args: argparse.Namespace) -> None:
    scenario = load_scenario(args.scenario)
    base = args.server.rstrip("/")
    info = _http("POST", f"{base}/sessions", {
        "preset": args.preset,
        "slides": [s.model_dump() for s in scenario.slides],
        "tick_interval_seconds": args.tick,
    })
    ws_url = base.replace("http", "ws", 1) + f"/sessions/{info['id']}/ws"
    async with websockets.connect(ws_url) as ws:
        client = Client(ws, args.verbose)
        reader = asyncio.create_task(client.read())
        await asyncio.sleep(0.1)

        await client.request("start")
        seq, now, took = 0, 0.0, False
        for chunk in scenario.chunks:
            await asyncio.sleep(max(0.0, chunk.start - now) / args.speed)
            slide = getattr(chunk, "slide", None)
            if slide is not None:
                await client.request("slide", index=slide)
            await asyncio.sleep((chunk.end - chunk.start) / args.speed)
            now = chunk.end
            await client.request("transcript", seq=seq, text=chunk.text,
                                 duration=(chunk.end - chunk.start) / args.speed)
            seq += 1
            if args.take_hands and not took and not client.raised.empty():
                hand = client.raised.get_nowait()
                took = True  # call on one hand mid-talk, like a real class
                await client.request("take_question", question_id=hand["question_id"])
                await _answer(client, 1000 + seq, hand["question_id"],
                              "Good question, partitions force a choice between consistency and availability.")
                await client.request("answer_done", question_id=hand["question_id"])

        await asyncio.sleep(1.0)
        await client.request("end_presenting")
        answers = iter(scenario.qa_answers)
        while True:
            ack = await client.request("next_question")
            if ack["type"] == "error" or ack["result"]["done"]:
                break
            seq += 1
            await _answer(client, seq, ack["result"]["question_id"], next(answers, ""))
        await client.request("end_qa")
        await client.request("finish")
        reader.cancel()

    report = _http("GET", f"{base}/sessions/{info['id']}/report")
    print("\nreport:")
    print(json.dumps({k: report[k] for k in ("questions", "delivery")}, indent=2))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description="Play a scripted talk against a running FrontRow server.")
    p.add_argument("scenario", nargs="?", type=Path, default=DEFAULT_SCENARIO)
    p.add_argument("--server", default="http://127.0.0.1:8000")
    p.add_argument("--preset", default="default")
    p.add_argument("--tick", type=float, default=5.0, help="tick interval for this session")
    p.add_argument("--speed", type=float, default=1.0, help="play the talk N times faster")
    p.add_argument("--take-hands", action="store_true", help="call on the first raised hand")
    p.add_argument("--verbose", action="store_true", help="also print reactions and transcript")
    asyncio.run(run(p.parse_args(argv)))


if __name__ == "__main__":
    main()
