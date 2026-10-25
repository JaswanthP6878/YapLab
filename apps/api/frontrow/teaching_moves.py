"""Report-only teaching-move predictions from the optional TalkMoves baseline.

No scientific Python dependency or model is loaded until a nonempty report is
requested. Only committed, trusted local artifacts are deserialized. Install
with ``uv sync --extra data``; without the extra the report omits this section.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

_MODEL_DIR = Path(__file__).resolve().with_name("models")
MODEL_PATH = _MODEL_DIR / "talkmoves.joblib"
BENCHMARKS_PATH = _MODEL_DIR / "talkmoves_benchmarks.json"
METRICS_PATH = _MODEL_DIR / "talkmoves_metrics.json"
DATASET = "TalkMoves: 567 K-12 math lessons (Suresh et al., 2022), CC BY-NC-SA 4.0"
METHOD = "TF-IDF + logistic regression"
MOVES = (
    (1, "keeping_together", "Checking in with the room"),
    (6, "pressing_for_reasoning", "Asking why"),
    (5, "pressing_for_accuracy", "Asking for precision"),
    (2, "getting_students_to_relate", "Connecting ideas"),
)
_DISPLAYED = frozenset(label for label, _, _ in MOVES)
_logger = logging.getLogger(__name__)
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+|[\r\n]+")
# Classroom teaching moves are prompts to the room. In a presenter's monologue the
# classifier also fires on plain explanations, so displayed moves count only for
# questions: a trailing "?" or a leading interrogative/auxiliary word.
_QUESTION = re.compile(
    r"\?\s*$|^(?:(?:so|and|okay|ok|now|well)\b[\s,]*)?"
    r"(?:who|what|why|how|when|where|which|does|do|did|is|are|can|could|would|should|will|have|has)\b",
    re.IGNORECASE,
)


@lru_cache(maxsize=1)
def _load_artifacts() -> tuple[Any, dict[str, Any], dict[str, Any]] | None:
    """Cache the trusted local pipeline and its measured reference metadata."""
    if not all(path.is_file() for path in (MODEL_PATH, BENCHMARKS_PATH, METRICS_PATH)):
        return None
    try:
        import joblib

        model = joblib.load(MODEL_PATH)
        benchmarks = json.loads(BENCHMARKS_PATH.read_text(encoding="utf-8"))
        metrics = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
        return model, benchmarks, metrics
    except ImportError:
        return None
    except Exception:  # noqa: BLE001 - advisory analysis must not break a report
        _logger.warning("Teaching-moves artifacts could not be loaded; omitting analysis")
        return None


def analyze(segments: list[str]) -> dict[str, Any] | None:
    """Classify presenter sentences one at a time.

    Each sentence contributes to one class. All seven classes participate in
    prediction, including the three not displayed; they still count in the rate
    denominator. Sentences are classified without context: the training context
    is a preceding *student* turn, and pairing a presenter answer with the
    presenter's own question made answers look like the question's move. A
    displayed move counts only for a question; other sentences fall back to
    ``none``. Examples are the presenter's two most confident sentences for
    each displayed move. Segments and sentence order are retained.
    """
    sentences = [
        sentence.strip()
        for segment in segments
        for sentence in _SENTENCE_BOUNDARY.split(segment.strip())
        if sentence.strip() and any(character.isalnum() for character in sentence)
    ]
    if not sentences:
        return None
    artifacts = _load_artifacts()
    if artifacts is None:
        return None
    pipeline, benchmarks, metrics = artifacts
    inputs = [f" [SEP] {sentence}".lower() for sentence in sentences]
    try:
        probabilities = pipeline.predict_proba(inputs)
        classes = [int(label) for label in pipeline.classes_]
        predictions: dict[int, list[tuple[float, int, str]]] = {label: [] for label in classes}
        for index, (sentence, row) in enumerate(zip(sentences, probabilities, strict=True)):
            column = max(range(len(classes)), key=lambda i: row[i])
            label = classes[column]
            if label in _DISPLAYED and not _QUESTION.search(sentence):
                label = 0
            predictions.setdefault(label, []).append((float(row[column]), index, sentence))
        moves = []
        for label, key, title in MOVES:
            matches = predictions.get(label, [])
            moves.append({
                "key": key,
                "label": title,
                "f1": metrics["per_class"][str(label)]["f1-score"],
                "count": len(matches),
                "per_100": round(100 * len(matches) / len(sentences), 1),
                "benchmark": benchmarks[key],
                "examples": [
                    sentence
                    for _, _, sentence in sorted(matches, key=lambda item: (-item[0], item[1]))[:2]
                ],
            })
        return {
            "dataset": DATASET,
            "model": {
                "method": METHOD,
                "accuracy": metrics["accuracy"],
                "macro_f1": metrics["macro_f1"],
            },
            "sentences": len(sentences),
            "moves": moves,
        }
    except Exception:  # noqa: BLE001 - advisory analysis must not break a report
        _logger.warning("Teaching-moves analysis failed; omitting analysis")
        return None
