# Teaching-moves coach: data science and ethics

YapLab adds a report-only classifier for four teaching moves. It estimates how often a presenter checks in, asks for reasoning, seeks precision, or invites connections between learners' ideas. It does not judge whether the content is correct, change live listener behavior, or measure teaching effectiveness.

## Dataset and selection

We looked for openly licensed, expert-annotated classroom discourse with sentence labels and identifiable lesson boundaries. We selected [TalkMoves](https://github.com/SumnerLab/TalkMoves); see the [datasheet and full Suresh et al. (LREC 2022) citation](../data/README.md) for sources, label definitions, permissions, and snapshot checksums.

The source corpus contains **567 lesson transcripts or excerpts**. The pinned download has 150,918 teacher training rows and 23,250 teacher test rows before filtering. Removing only blank target sentences leaves **150,644 training pairs** and **23,208 test pairs**. Empty context is retained. This is a dataset of real classroom discourse, not transcripts synthesized by YapLab's agents.

## Method 1: predictive modeling

The supervised target is one of six teacher moves or `none`. The input is the supplied `text_a` context, the literal separator ` [SEP] `, and `text_b`, the teacher sentence. The model is a scikit-learn pipeline:

| Component | Setting |
|---|---|
| TF-IDF | Lowercased word unigrams and bigrams; sublinear term frequency; at most 60,000 features |
| Classifier | Class-balanced logistic regression, L-BFGS solver, maximum 1,000 iterations |
| Selection | C ∈ {1, 2, 4}; standard macro-F1 on a stratified 10% split of training pairs; random seed 42 |
| Final fit | Refit the chosen pipeline on all retained training pairs |
| Test | One evaluation on the retained official test split, after model selection |

The validation split is at the sentence-pair level, not the teacher or lesson level; related classroom language can occur on both sides. Validation TF-IDF is fitted on the 135,579 fit pairs and reused across C candidates; the 15,065 validation pairs are transformed without fitting. The final pipeline refits its vectorizer on all retained training pairs. The official test set is not used to select C or rewrite the model after seeing its score.

| Validation C | Macro-F1 | Accuracy |
|---:|---:|---:|
| 1 | 0.5421 | 71.64% |
| 2 | 0.5561 | 73.61% |
| 4 (selected) | 0.5612 | 75.01% |

**Held-out test accuracy: 73.23%; seven-class macro-F1: 0.5350.** The final fit used 60,000 features and took 14.71 seconds in this run. The compressed model is 3,886,675 bytes (3.89 MB), below the 15 MB goal.

| Teacher class | Test support | Precision | Recall | F1 | Reported? |
|---|---:|---:|---:|---:|---|
| None | 15,618 | 0.910 | 0.768 | 0.833 | No |
| Keeping everyone together | 3,071 | 0.537 | 0.612 | 0.572 | Yes |
| Getting students to relate | 306 | 0.339 | 0.559 | 0.422 | Yes |
| Restating | 295 | 0.214 | 0.620 | 0.318 | No |
| Revoicing | 562 | 0.150 | 0.351 | 0.210 | No |
| Pressing for accuracy | 3,076 | 0.672 | 0.764 | 0.715 | Yes |
| Pressing for reasoning | 280 | 0.601 | 0.768 | 0.674 | Yes |

The retained official split is not free of repeated text: **3,401 of 23,208 test rows (14.65%) share a context–target pair with training** after lowercasing and collapsing whitespace. Validation has 2,895 such overlapping rows out of 15,065. There are also 811 training feature-pair groups with conflicting labels. We preserved the supplied partitions and duplicates for reproducibility; this possible leakage and context ambiguity can inflate apparent generalization. These TSV scores alone do not verify generalization to new teachers or lessons.

Accuracy is the fraction of correct seven-class predictions. Macro-F1 is the unweighted mean of the seven class F1 scores, including `none`; F1 combines precision and recall. Class imbalance makes accuracy alone insufficient. This is our lightweight baseline, not the paper's transformer model; the upstream notebook uses a different custom F1 definition, so those headline numbers are not directly comparable.

Restating and revoicing are trained and evaluated but excluded from user feedback because each has F1 below 0.35. The report exposes exactly these four moves, in order:

1. `keeping_together` — Checking in with the room.
2. `pressing_for_reasoning` — Asking why.
3. `pressing_for_accuracy` — Asking for precision.
4. `getting_students_to_relate` — Connecting ideas.

## Method 2: bootstrap statistical inference

For each usable lesson and each reported move, we compute:

`rate = 100 × human-labeled teacher sentences with that move / all human-labeled teacher sentences`

The denominator includes `none` and the two excluded move classes. Student sentences and spreadsheet metadata are not teacher observations. A lesson with zero instances of a move contributes a rate of zero. Each lesson has equal weight when computing the median and the 25th and 75th percentiles, rather than allowing long lessons to dominate.

**Reference denominator: 566 eligible lessons or lesson excerpts**, containing 175,073 nonblank human-labeled teacher sentences. We inspect all 567 native workbooks and exclude the one with no eligible teacher sentences. This is not a 567-lesson benchmark and is not inferred from a split filename.

Rows with a valid student tag (native codes 1–5) are excluded even when a teacher tag is also present: this removes 73 dual-tag rows. Otherwise teacher tags 1, 2, 3, 4, 5, 8, and 9 map to the seven model classes, irrespective of the Speaker field. Blank sentences, missing tags, Context code 7, and undocumented codes 6/128 are excluded. Tag-based extraction retains named teachers and one workbook with a nonstandard speaker-column header. These native-workbook and TSV representations have different extraction histories and their sentence totals need not match.

| Move | Median | p25 | p75 | 95% CI for median | Lessons |
|---|---:|---:|---:|---|---:|
| Checking in with the room | 13.612 | 9.733 | 19.165 | [12.784, 14.094] | 566 |
| Asking why | 0.642 | 0.000 | 1.846 | [0.499, 0.750] | 566 |
| Asking for precision | 13.709 | 9.870 | 17.961 | [12.886, 14.354] | 566 |
| Connecting ideas | 1.098 | 0.000 | 3.042 | [0.920, 1.325] | 566 |

All table values except lesson counts are moves per 100 teacher sentences, rounded here to three decimals. Full precision, exclusions, and extraction audit are in [benchmark_summary.json](../data/results/benchmark_summary.json); [lesson_rates.json](../data/results/lesson_rates.json) preserves lesson-level label counts with hashed IDs and source checksums, without transcript text.

For each move, the script samples the usable lesson rates with replacement, computes the median for each of **2,000 bootstrap resamples**, and takes the 2.5th and 97.5th percentiles as a **95% confidence interval for the median**, using seed **42** and the same resampled lesson indices across the four moves. The p25–p75 band describes variation across lessons; it is not a confidence interval. The confidence interval describes sampling variability within this corpus, not uncertainty about a presenter's predicted rate or evidence of a causal benefit from using more moves. Repeated teachers and lessons from common sources may violate an independent-lesson assumption; no demographic or teacher-cluster adjustment is made.

## Reproduce and inspect

From the repository root:

```bash
bash data/scripts/fetch_talkmoves.sh
cd apps/api
uv sync --extra data
uv run --extra data --with matplotlib==3.10.7 --with openpyxl==3.1.5 python ../../data/scripts/train_talkmoves.py
uv run --extra data --with matplotlib==3.10.7 --with openpyxl==3.1.5 python ../../data/scripts/benchmarks.py
uv run --extra data python verify.py
```

The source is revision-pinned and checksummed in [source_manifest.json](../data/results/source_manifest.json). [metrics.json](../data/results/metrics.json) contains the actual training configuration, validation candidates, class metrics, software versions, and model size. The inference artifacts are [talkmoves.joblib](../apps/api/frontrow/models/talkmoves.joblib) and [talkmoves_benchmarks.json](../apps/api/frontrow/models/talkmoves_benchmarks.json). Raw downloads remain ignored by Git.

| Figure | What it shows |
|---|---|
| [confusion_matrix.png](../data/results/confusion_matrix.png) | Human vs predicted class; counts and within-class proportions on the official test split |
| [class_distribution.png](../data/results/class_distribution.png) | Train/test class shares after blank-target filtering |
| [benchmark_keeping_together.png](../data/results/benchmark_keeping_together.png) | Human-labeled check-in rates per lesson |
| [benchmark_pressing_for_reasoning.png](../data/results/benchmark_pressing_for_reasoning.png) | Human-labeled reasoning rates per lesson |
| [benchmark_pressing_for_accuracy.png](../data/results/benchmark_pressing_for_accuracy.png) | Human-labeled precision rates per lesson |
| [benchmark_getting_students_to_relate.png](../data/results/benchmark_getting_students_to_relate.png) | Human-labeled relating rates per lesson |

Paths above are repository paths relative to this document. These plots and their JSON sources can be used in the submission slides with TalkMoves attribution. Serving requires the pinned scikit-learn 1.7.2 and joblib 1.5.2 extra; plotting/XLSX parsing uses temporary matplotlib 3.10.7 and openpyxl 3.1.5 dependencies in the commands above. Exact run versions are recorded in metrics.json.

## How it appears in the product

After a session, `GET /sessions/{id}/report` can include `teaching_moves`: dataset attribution, the method and test metrics, the number of classified sentences, and four move records. Each record contains its predicted count and rate per 100 presenter sentences, held-out F1, the human-labeled classroom benchmark and interval, and up to two of the presenter's own examples with the highest predicted probability for that move. Probability ranks examples; it is not a calibrated confidence guarantee.

Only presenter transcript segments are analyzed, including presenter answers; simulated listener questions are not model input. Runtime segments are split into sentences and paired with the previous presenter sentence. With no transcript or without the optional model/dependencies, the key is absent and the existing report remains available. Loading is lazy and inference is local to the backend. Part A supplies this optional payload; the dedicated report card is a separate Part B integration.

## Limits on interpretation

- **Domain shift:** the source is classroom discussion; a college lecture, founder pitch, or interview offers different opportunities to use these moves. No college-transfer or fairness evaluation has been performed.
- **Context shift:** the upstream teacher TSV generally pairs a teacher sentence with a prior student sentence or blank context. The runtime pairs presenter sentences, so conversational cues differ.
- **Measurement error:** human annotation is a reference label, not perfect truth. Speech-recognition and sentence-boundary errors add runtime noise. Rare classes are difficult; excluded classes still count in the sentence denominator.
- **Benchmark mismatch:** human-coded source rates and predicted user rates are not interchangeable. The median is descriptive context, not a target, pass mark, or optimum. A zero count can reflect the task or the audience, not poor ability.
- **Coverage:** this model detects a narrow discourse taxonomy. It does not establish learning gains, factual accuracy, tone, gestures, or the quality of an explanation. Review the presenter's examples before drawing conclusions.

## Ethics statement

We selected TalkMoves for its expert labels and documented permission for noncommercial reuse. We attribute Suresh and colleagues, link the CC BY-NC-SA 4.0 license, record our transformations, and keep raw classroom files out of this repository. The license is not permission for unrestricted commercial deployment. Privacy claims require care: the authors anonymized TalkBack-collected names, but some public-source transcripts retain original names. We therefore avoid publishing classroom excerpts or identifying participants. YapLab keeps session objects, transcripts, and audio in server memory, without database persistence; ending a session does not immediately erase that memory. Speech and language-model providers still process session content under their own arrangements. The corpus mainly reflects U.S. K-12 mathematics, with international examples, and does not establish validity for college talks, accents, or other cultures. Class imbalance and transcription errors can distort predictions; weak restating and revoicing categories are excluded from feedback. We show dataset attribution and per-move F1, explain uncertainty, and present classroom distributions as context rather than targets. Feedback is advisory, never a grade or a judgment of a person's ability. Users should inspect their own examples instead of treating counts as proof of teaching quality.

*189 words. Source privacy distinctions: [Suresh et al., sections 3.2.2 and 4.2–4.3](https://aclanthology.org/2022.lrec-1.497.pdf). Session retention verified in [server.py](../apps/api/frontrow/server.py), [transcript.py](../apps/api/frontrow/transcript.py), and [App.jsx](../frontend/src/App.jsx): sessions are process-memory objects and the browser's last report is React state, with no session database or browser persistence implemented here. Provider processing is separate from this retention claim.*
