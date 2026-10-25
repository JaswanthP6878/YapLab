"""Shared TalkMoves constants, source manifests, and UTF-8 split loading."""

from __future__ import annotations

import csv
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/talkmoves"
RESULTS = ROOT / "data/results"
MODELS = ROOT / "apps/api/frontrow/models"
SEED = 42
LABELS = {
    0: "none",
    1: "keeping_together",
    2: "getting_students_to_relate",
    3: "restating",
    4: "revoicing",
    5: "pressing_for_accuracy",
    6: "pressing_for_reasoning",
}
MOVE_LABELS = {
    "keeping_together": "Checking in with the room",
    "pressing_for_reasoning": "Asking why",
    "pressing_for_accuracy": "Asking for precision",
    "getting_students_to_relate": "Connecting ideas",
}
MOVE_IDS = {key: label for label, key in LABELS.items() if key in MOVE_LABELS}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def source_manifest(revision: str, archive: Path) -> dict:
    paths = sorted(path for path in RAW.rglob("*") if path.is_file() and path.name != ".source-revision")
    manifest = {
        "dataset": "TalkMoves",
        "repository": "https://github.com/SumnerLab/TalkMoves",
        "revision": revision,
        "revision_url": f"https://github.com/SumnerLab/TalkMoves/tree/{revision}",
        "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
        "license": "CC BY-NC-SA 4.0",
        "license_url": f"https://github.com/SumnerLab/TalkMoves/blob/{revision}/LICENSE",
        "citation_url": "https://aclanthology.org/2022.lrec-1.497/",
        "archive_sha256": sha256(archive),
        "files": [{"path": str(path.relative_to(RAW)), "bytes": path.stat().st_size, "sha256": sha256(path)} for path in paths],
    }
    write_json(RESULTS / "source_manifest.json", manifest)
    return manifest


def read_split(name: str) -> list[dict]:
    with (RAW / "data" / f"{name}_teacher.tsv").open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source, delimiter="\t")
        if not {"text_a", "text_b", "labels"}.issubset(reader.fieldnames or []):
            raise ValueError(f"Unexpected {name} teacher columns: {reader.fieldnames}")
        rows = list(reader)
    for row in rows:
        value = float(row["labels"])
        if not value.is_integer() or int(value) not in LABELS:
            raise ValueError(f"Invalid label in {name}")
        row["labels"] = int(value)
    return rows


def feature_text(row: dict) -> str:
    return (row.get("text_a") or "") + " [SEP] " + (row.get("text_b") or "")


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--manifest":
        result = source_manifest(sys.argv[2], Path(sys.argv[3]))
        print(json.dumps({"revision": result["revision"], "files": len(result["files"]), "manifest": str(RESULTS / "source_manifest.json")}))
    else:
        raise SystemExit("Use --manifest REVISION ARCHIVE")
