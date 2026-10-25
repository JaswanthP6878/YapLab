"""Offline, dependency-light checks for the report-only TalkMoves coach.

Mocked classifier checks always run. The two fitted predictions additionally
run when the optional data dependencies and exported artifacts are installed.
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import sys
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from frontrow import teaching_moves
from frontrow.models import TimelineEvent, TranscriptChunk


_MOVES = (
    ("keeping_together", "Checking in with the room", 1, 0.57),
    ("pressing_for_reasoning", "Asking why", 6, 0.68),
    ("pressing_for_accuracy", "Asking for precision", 5, 0.71),
    ("getting_students_to_relate", "Connecting ideas", 2, 0.41),
)
_BENCHMARKS = {
    key: {"median": 9.8, "p25": 5.1, "p75": 14.6,
          "ci95_median": [8.9, 10.7], "lessons": 504}
    for key, _, _, _ in _MOVES
}
_METRICS = {
    "accuracy": 0.72,
    "macro_f1": 0.53,
    "per_class": {str(label): {"f1-score": f1} for _, _, label, f1 in _MOVES},
}


class _Pipeline:
    # A probability column is identified by classes_, not by its array index.
    classes_ = [6, 0, 2, 1, 5, 3, 4]

    def __init__(self, predictions=None):
        self.predictions = predictions
        self.inputs = []

    def predict_proba(self, inputs):
        self.inputs = list(inputs)
        predictions = self.predictions or [(0, 0.9)] * len(self.inputs)
        assert len(predictions) == len(self.inputs), (predictions, self.inputs)
        rows = []
        for label, probability in predictions:
            row = [(1 - probability) / 6] * len(self.classes_)
            row[self.classes_.index(label)] = probability
            rows.append(row)
        return rows


@contextmanager
def _artifacts(pipeline):
    with patch.object(teaching_moves, "_load_artifacts", return_value=(pipeline, _BENCHMARKS, _METRICS)):
        yield


def _assert_contract(result):
    assert result is not None, "installed classifier should produce a report"
    assert result["dataset"] == "TalkMoves: 567 K-12 math lessons (Suresh et al., 2022), CC BY-NC-SA 4.0"
    assert result["model"] == {"method": "TF-IDF + logistic regression", "accuracy": 0.72, "macro_f1": 0.53}
    assert [(move["key"], move["label"]) for move in result["moves"]] == [(key, label) for key, label, _, _ in _MOVES]
    for move, (key, _, _, f1) in zip(result["moves"], _MOVES):
        assert move["f1"] == f1, move
        assert move["benchmark"] == _BENCHMARKS[key], move
        assert isinstance(move["count"], int) and move["count"] >= 0
        assert isinstance(move["per_100"], (int, float))
        assert len(move["examples"]) <= 2


def check_teaching_moves_contract_and_ranked_examples() -> None:
    sentences = [
        "Does that make sense to everyone?",
        "Are you all following?",
        "Is the room with me?",
        "Why do you think that works?",
        "Can you state the exact value?",
        "How does your idea connect to hers?",
        "So you are saying seven.",
        "That means we combine the terms.",
        "We now move on.",
    ]
    pipeline = _Pipeline([(1, 0.65), (1, 0.95), (1, 0.80), (6, 0.90),
                          (5, 0.85), (2, 0.88), (3, 0.75), (4, 0.75), (0, 0.90)])
    with _artifacts(pipeline):
        result = teaching_moves.analyze(sentences)
    _assert_contract(result)
    assert result["sentences"] == 9, result
    together, reasoning, accuracy, relating = result["moves"]
    assert together["count"] == 3 and together["per_100"] == 33.3, together
    assert together["examples"] == ["Are you all following?", "Is the room with me?"], together
    for move, sentence in ((reasoning, sentences[3]), (accuracy, sentences[4]), (relating, sentences[5])):
        assert move["count"] == 1 and move["per_100"] == 11.1, move
        assert move["examples"] == [sentence], move
    assert len(result["moves"]) == 4, "weak restating/revoicing classes stay out of the report"
    assert json.loads(json.dumps(result)) == result, "the report must be ordinary JSON data"


def check_teaching_moves_sentence_boundaries_and_context() -> None:
    pipeline = _Pipeline()
    sentences = ["The value is 3.14.", "Are you following?", "Yes!", "Next thought", "The next segment."]
    with _artifacts(pipeline):
        result = teaching_moves.analyze(["  The value is 3.14. Are you following? Yes!\nNext thought  ", "  ", "The next segment."])
    assert result["sentences"] == len(sentences), result
    # Sentences are classified without context: a presenter's previous question
    # must not turn the following answer into that question's move.
    assert pipeline.inputs == [f" [SEP] {sentence}".lower() for sentence in sentences], pipeline.inputs
    assert all(move["count"] == 0 and move["per_100"] == 0 and move["examples"] == [] for move in result["moves"]), result


def check_teaching_moves_count_only_questions() -> None:
    sentences = [
        "Why do you think we walk backwards?",
        "Because each layer passes its effect on to the next.",
        "First we measure how wrong the guess was.",
        "So what exactly is a small step",
        "Does that make sense so far?",
    ]
    # The classifier labels every sentence as a move; only the questions count.
    pipeline = _Pipeline([(6, 0.9), (6, 0.9), (5, 0.9), (5, 0.8), (1, 0.9)])
    with _artifacts(pipeline):
        result = teaching_moves.analyze(sentences)
    _assert_contract(result)
    together, reasoning, accuracy, relating = result["moves"]
    assert reasoning["count"] == 1 and reasoning["examples"] == [sentences[0]], reasoning
    assert accuracy["count"] == 1 and accuracy["examples"] == [sentences[3]], accuracy
    assert together["count"] == 1 and relating["count"] == 0, result
    assert result["sentences"] == 5 and reasoning["per_100"] == 20.0, "statements still count in the denominator"


def check_teaching_moves_empty_input_needs_no_model() -> None:
    with patch.object(teaching_moves, "_load_artifacts", side_effect=AssertionError("empty speech must not load the model")):
        assert teaching_moves.analyze([]) is None
        assert teaching_moves.analyze(["", "  \n ", "\t"]) is None


@contextmanager
def _temporary_artifact_paths():
    with TemporaryDirectory(prefix="frontrow-teaching-check-") as directory:
        root = Path(directory)
        model = root / "talkmoves.joblib"
        benchmark = root / "benchmarks.json"
        metrics = root / "metrics.json"
        model.write_bytes(b"offline test placeholder")
        benchmark.write_text(json.dumps(_BENCHMARKS), encoding="utf-8")
        metrics.write_text(json.dumps(_METRICS), encoding="utf-8")
        teaching_moves._load_artifacts.cache_clear()
        try:
            with patch.multiple(teaching_moves, MODEL_PATH=model, BENCHMARKS_PATH=benchmark, METRICS_PATH=metrics):
                yield model
        finally:
            teaching_moves._load_artifacts.cache_clear()


def check_teaching_moves_optional_artifacts_and_dependencies() -> None:
    with _temporary_artifact_paths() as model:
        model.unlink()
        assert teaching_moves.analyze(["A presenter sentence."]) is None
    with _temporary_artifact_paths(), patch.dict(sys.modules, {"joblib": None}):
        assert teaching_moves.analyze(["A presenter sentence."]) is None

    # joblib may be importable while sklearn is missing during unpickling.
    joblib = ModuleType("joblib")
    joblib.load = lambda _: importlib.import_module("sklearn")
    with _temporary_artifact_paths(), patch.dict(sys.modules, {"joblib": joblib, "sklearn": None}):
        assert teaching_moves.analyze(["A presenter sentence."]) is None


def check_teaching_moves_prediction_failure_is_optional() -> None:
    pipeline = _Pipeline()
    with _artifacts(pipeline), patch.object(pipeline, "predict_proba", side_effect=RuntimeError("offline model failure")):
        assert teaching_moves.analyze(["A presenter sentence."]) is None


def check_teaching_moves_report_presenter_only_and_optional() -> None:
    # Import the default server in an explicitly offline environment.
    with patch.dict(os.environ, {"FRONTROW_LLM": "fake", "FRONTROW_TTS": "none", "FRONTROW_STT": "none"}, clear=True):
        server = importlib.import_module("frontrow.server")
    student_question = "Could you explain the student's private question?"
    session = SimpleNamespace(id="offline-teaching-report", events=[
        TimelineEvent(type="question_taken", t=2, data={"question": student_question}),
    ], transcript=[
        TranscriptChunk(start=0, end=1, text="We introduce the lesson."),
        TranscriptChunk(start=3, end=4, text="Here is my answer to the student.", answer_to="q1"),
    ])
    payload = {"sentences": 2, "moves": []}
    with patch.object(server.teaching_moves, "analyze", return_value=None):
        baseline = server.session_summary(session)
    with patch.object(server.teaching_moves, "analyze", return_value=payload) as analyze:
        result = server.session_summary(session)
    analyze.assert_called_once_with([chunk.text for chunk in session.transcript])
    assert result.pop("teaching_moves") == payload
    assert result == baseline, "the new report section must leave existing fields unchanged"
    assert student_question not in str(analyze.call_args), "student questions must never enter the presenter classifier"
    assert "teaching_moves" not in baseline, "an unavailable model omits the optional key"
    session.transcript = []
    with _artifacts(_Pipeline()):
        assert "teaching_moves" not in server.session_summary(session), "no transcript omits the optional key"


def check_teaching_moves_fitted_predictions() -> None:
    dependencies = ("joblib", "sklearn")
    if any(importlib.util.find_spec(name) is None for name in dependencies):
        print("  SKIP  fitted TalkMoves predictions (optional data packages are not installed)")
        return
    paths = (teaching_moves.MODEL_PATH, teaching_moves.BENCHMARKS_PATH, teaching_moves.METRICS_PATH)
    missing = [str(path) for path in paths if not Path(path).is_file()]
    assert not missing, f"installed data packages require the committed artifacts: {missing}"
    teaching_moves._load_artifacts.cache_clear()
    for sentence, expected in (("Does that make sense to everyone?", "keeping_together"),
                               ("Why do you think that works?", "pressing_for_reasoning")):
        result = teaching_moves.analyze([sentence])
        assert result is not None, "installed model and dependencies must load successfully"
        assert result["sentences"] == 1, result
        predicted = [move["key"] for move in result["moves"] if move["count"] == 1]
        assert predicted == [expected], (sentence, predicted, result)


TEACHING_MOVE_CHECKS = [
    ("teaching moves: four-move contract + ranked presenter examples", check_teaching_moves_contract_and_ranked_examples),
    ("teaching moves: sentence boundaries, no cross-sentence context", check_teaching_moves_sentence_boundaries_and_context),
    ("teaching moves: displayed moves count only for questions", check_teaching_moves_count_only_questions),
    ("teaching moves: empty speech needs no model", check_teaching_moves_empty_input_needs_no_model),
    ("teaching moves: absent artifacts / optional dependencies omit feedback", check_teaching_moves_optional_artifacts_and_dependencies),
    ("teaching moves: classifier failure leaves feedback optional", check_teaching_moves_prediction_failure_is_optional),
    ("teaching moves: report analyzes presenter speech only + stays additive", check_teaching_moves_report_presenter_only_and_optional),
    ("teaching moves: fitted classroom-model predictions", check_teaching_moves_fitted_predictions),
]
