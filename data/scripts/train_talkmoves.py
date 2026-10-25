"""Reproduce the train-only C selection and one official-test evaluation.

Training environment: scikit-learn==1.7.2 joblib==1.5.2 matplotlib==3.10.7.
Run after bash data/scripts/fetch_talkmoves.sh. Never select C on test scores.
"""

from __future__ import annotations

import json
import platform
import time
from collections import Counter, defaultdict
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scipy
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from threadpoolctl import threadpool_limits

from talkmoves_common import LABELS, MODELS, RAW, RESULTS, SEED, feature_text, read_split, sha256, write_json

DISPLAY = ["None", "Keeping\ntogether", "Relating\nstudents", "Restating", "Revoicing", "Pressing for\naccuracy", "Pressing for\nreasoning"]


def normalized_pair(row):
    return tuple(" ".join((row.get(key) or "").lower().split()) for key in ("text_a", "text_b"))


def profile(rows):
    exact = Counter((row["text_a"], row["text_b"], row["labels"]) for row in rows)
    normalized = Counter((*normalized_pair(row), row["labels"]) for row in rows)
    label_sets = defaultdict(set)
    for row in rows:
        label_sets[normalized_pair(row)].add(row["labels"])
    conflicting = {key for key, labels in label_sets.items() if len(labels) > 1}
    return {
        "rows": len(rows), "columns": ["text_a", "text_b", "labels"],
        "empty_context_rows": sum(not (row["text_a"] or "").strip() for row in rows),
        "empty_target_rows": sum(not (row["text_b"] or "").strip() for row in rows),
        "labels": {str(label): count for label, count in sorted(Counter(row["labels"] for row in rows).items())},
        "exact_duplicate_excess_rows": sum(count - 1 for count in exact.values()),
        "normalized_duplicate_excess_rows": sum(count - 1 for count in normalized.values()),
        "conflicting_normalized_feature_groups": len(conflicting),
        "rows_in_conflicting_feature_groups": sum(normalized_pair(row) in conflicting for row in rows),
    }


def classifier(c):
    return LogisticRegression(C=c, class_weight="balanced", solver="lbfgs", max_iter=1000, random_state=SEED)


def vectorizer():
    return TfidfVectorizer(lowercase=True, ngram_range=(1, 2), max_features=60000, sublinear_tf=True)


def plot_confusion(matrix, accuracy, macro_f1):
    support = matrix.sum(axis=1)
    proportions = matrix / np.maximum(support[:, None], 1)
    fig, ax = plt.subplots(figsize=(12, 9), constrained_layout=True)
    image = ax.imshow(proportions, cmap="Blues", vmin=0, vmax=1)
    for row in range(7):
        for column in range(7):
            ax.text(column, row, f"{matrix[row, column]:,}\n{proportions[row, column]:.0%}",
                    ha="center", va="center", fontsize=9,
                    color="white" if proportions[row, column] > 0.5 else "#253346")
    ax.set_xticks(range(7), DISPLAY, fontsize=10)
    ax.set_yticks(range(7), [f"{name.replace(chr(10), ' ')}\n(n={n:,})" for name, n in zip(DISPLAY, support)], fontsize=10)
    ax.set_xlabel("Model-predicted teacher move", labelpad=12)
    ax.set_ylabel("Human-annotated teacher move", labelpad=10)
    ax.set_title(f"TalkMoves official test split (n={matrix.sum():,})\nAccuracy {accuracy:.1%} · Macro-F1 {macro_f1:.3f} across all seven classes", pad=16)
    fig.colorbar(image, ax=ax, label="Share of each human-labeled class", shrink=0.8)
    fig.savefig(RESULTS / "confusion_matrix.png", dpi=170)
    plt.close(fig)


def plot_distribution(train_y, test_y):
    train_counts = np.bincount(train_y, minlength=7)
    test_counts = np.bincount(test_y, minlength=7)
    fig, ax = plt.subplots(figsize=(11, 6), constrained_layout=True)
    positions = np.arange(7)
    first = ax.barh(positions - 0.19, train_counts / len(train_y) * 100, height=0.36, color="#41678d", label=f"Training (n={len(train_y):,})")
    second = ax.barh(positions + 0.19, test_counts / len(test_y) * 100, height=0.36, color="#c88b34", label=f"Official test (n={len(test_y):,})")
    ax.bar_label(first, fmt="%.1f%%", padding=4, fontsize=9)
    ax.bar_label(second, fmt="%.1f%%", padding=4, fontsize=9)
    ax.set_yticks(positions, [name.replace("\n", " ") for name in DISPLAY])
    ax.invert_yaxis()
    ax.set_xlim(0, 76)
    ax.set_xlabel("Share of human-labeled teacher sentences (%)")
    ax.set_title("TalkMoves teacher-label distribution\nEmpty target sentences excluded; missing previous-student context retained", pad=14)
    ax.grid(axis="x", color="#e6e9ed", linewidth=0.6)
    ax.set_axisbelow(True)
    ax.legend(loc="lower right", frameon=False)
    for side in ("top", "right"): ax.spines[side].set_visible(False)
    fig.savefig(RESULTS / "class_distribution.png", dpi=170)
    plt.close(fig)


def main():
    if sklearn.__version__ != "1.7.2" or joblib.__version__ != "1.5.2":
        raise RuntimeError("Use scikit-learn==1.7.2 and joblib==1.5.2 to reproduce the exported pipeline.")
    RESULTS.mkdir(parents=True, exist_ok=True)
    MODELS.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    raw_train = read_split("train")
    train = [row for row in raw_train if (row["text_b"] or "").strip()]
    x_train = [feature_text(row) for row in train]
    y_train = np.array([row["labels"] for row in train])
    fit_indices, val_indices = train_test_split(np.arange(len(train)), test_size=0.1, stratify=y_train, random_state=SEED)
    validation_vectorizer = vectorizer()
    with threadpool_limits(limits=1):
        x_fit = validation_vectorizer.fit_transform([x_train[index] for index in fit_indices])
        x_val = validation_vectorizer.transform([x_train[index] for index in val_indices])
        candidates = []
        for c in (1, 2, 4):
            candidate_started = time.perf_counter()
            model = classifier(c).fit(x_fit, y_train[fit_indices])
            prediction = model.predict(x_val)
            score = {"C": c, "macro_f1": float(f1_score(y_train[val_indices], prediction, labels=list(LABELS), average="macro", zero_division=0)),
                     "accuracy": float(accuracy_score(y_train[val_indices], prediction)),
                     "fit_seconds": time.perf_counter() - candidate_started, "iterations": model.n_iter_.tolist()}
            candidates.append(score)
            print(json.dumps({"validation": score}), flush=True)
        selected_c = max(candidates, key=lambda candidate: (candidate["macro_f1"], -candidate["C"]))["C"]
        pipeline = Pipeline([("tfidf", vectorizer()), ("classifier", classifier(selected_c))])
        refit_started = time.perf_counter()
        pipeline.fit(x_train, y_train)
        refit_seconds = time.perf_counter() - refit_started

        # First and only model evaluation on the supplied official test split.
        raw_test = read_split("test")
        test = [row for row in raw_test if (row["text_b"] or "").strip()]
        y_test = np.array([row["labels"] for row in test])
        predicted = pipeline.predict([feature_text(row) for row in test])
    report = classification_report(y_test, predicted, labels=list(LABELS), output_dict=True, zero_division=0)
    matrix = confusion_matrix(y_test, predicted, labels=list(LABELS))
    artifact = MODELS / "talkmoves.joblib"
    joblib.dump(pipeline, artifact, compress=3)
    if artifact.stat().st_size >= 15 * 1024 * 1024:
        raise RuntimeError("Compressed model exceeds the requested 15 MiB budget.")
    train_pairs = {normalized_pair(row) for row in train}
    train_targets = {" ".join(row["text_b"].lower().split()) for row in train}
    test_pairs = {normalized_pair(row) for row in test}
    fit_pairs = {normalized_pair(train[index]) for index in fit_indices}
    manifest = json.loads((RESULTS / "source_manifest.json").read_text())
    metrics = {
        "method": "TF-IDF + logistic regression", "accuracy": report["accuracy"],
        "macro_f1": report["macro avg"]["f1-score"], "weighted_f1": report["weighted avg"]["f1-score"],
        "per_class": {str(label): report[str(label)] for label in LABELS},
        "labels": {str(label): key for label, key in LABELS.items()},
        "training": {"rows": len(train), "official_test_rows": len(test), "refit_seconds": refit_seconds,
                     "selected_C": selected_c, "class_weight": "balanced", "solver": "lbfgs", "max_iter": 1000,
                     "features": {"ngram_range": [1, 2], "max_features": 60000, "sublinear_tf": True, "lowercase": True,
                                  "actual_features": len(pipeline["tfidf"].vocabulary_), "input": "text_a + ' [SEP] ' + text_b"}},
        "validation": {"source": "official training split only", "fraction": 0.1, "stratified": True, "seed": SEED,
                       "fit_rows": len(fit_indices), "validation_rows": len(val_indices), "selection_metric": "seven-class macro-F1",
                       "candidates": candidates, "validation_rows_with_feature_pair_in_fit": sum(normalized_pair(train[index]) in fit_pairs for index in val_indices)},
        "official_test_evaluations": 1,
        "data_quality": {"raw_train": profile(raw_train), "raw_test": profile(raw_test),
                         "clean_train": profile(train), "clean_test": profile(test),
                         "empty_target_policy": "Drop empty/whitespace text_b only; keep literal words such as None; retain empty text_a as missing previous-student context.",
                         "shared_normalized_feature_pairs_train_test": len(train_pairs & test_pairs),
                         "test_rows_with_feature_pair_in_train": sum(normalized_pair(row) in train_pairs for row in test),
                         "test_rows_with_teacher_text_in_train": sum(" ".join(row["text_b"].lower().split()) in train_targets for row in test)},
        "provenance": {"revision": manifest["revision"], "repository": manifest["repository"], "license": manifest["license"],
                       "train_sha256": sha256(RAW / "data/train_teacher.tsv"), "test_sha256": sha256(RAW / "data/test_teacher.tsv")},
        "artifact": {"path": "apps/api/frontrow/models/talkmoves.joblib", "bytes": artifact.stat().st_size, "sha256": sha256(artifact)},
        "versions": {"python": platform.python_version(), "scikit-learn": sklearn.__version__, "joblib": joblib.__version__,
                     "numpy": np.__version__, "scipy": scipy.__version__, "matplotlib": matplotlib.__version__},
        "confusion_matrix": matrix.tolist(),
        "limitations": ["Official TSV rows lack lesson identifiers: validation is row-stratified, not lesson-grouped.",
                        "Repeated short phrases/context pairs across splits can inflate apparent generalization; official partitions are preserved for comparability.",
                        "Upstream text_a is the previous student utterance; live inference supplies the previous presenter sentence, a context distribution shift.",
                        "Macro-F1 includes None and is not directly comparable to published talk-move-only F1.",
                        "K-12 mathematics discourse is not a validated college-presentation or teaching-quality score."],
        "elapsed_seconds": time.perf_counter() - started,
    }
    write_json(RESULTS / "metrics.json", metrics)
    compact = {key: metrics[key] for key in ("method", "accuracy", "macro_f1", "per_class", "labels", "provenance", "artifact", "versions")}
    write_json(MODELS / "talkmoves_metrics.json", compact)
    plot_confusion(matrix, metrics["accuracy"], metrics["macro_f1"])
    plot_distribution(y_train, y_test)
    print(json.dumps({"selected_C": selected_c, "accuracy": metrics["accuracy"], "macro_f1": metrics["macro_f1"], "model_bytes": artifact.stat().st_size, "refit_seconds": refit_seconds}), flush=True)


if __name__ == "__main__":
    main()
