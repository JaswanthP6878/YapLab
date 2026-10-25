# TalkMoves datasheet for YapLab

YapLab uses a teacher-sentence classifier for the final session report. This does not train the listener LLMs or change live reactions, hands, or voices. See [methods, measured results, and ethics](../docs/data-science.md).

## Source and identification

We sought openly licensed classroom-discourse data with expert sentence labels. TalkMoves was selected for authentic classroom language, a documented annotation scheme, and permission for noncommercial reuse. We verified the [official SumnerLab repository](https://github.com/SumnerLab/TalkMoves), its [license](https://github.com/SumnerLab/TalkMoves/blob/main/LICENSE), and the original paper.

**Citation:** Abhijit Suresh, Jennifer Jacobs, Charis Harty, Margaret Perkoff, James H. Martin, and Tamara Sumner. 2022. [The TalkMoves Dataset: K-12 Mathematics Lesson Transcripts Annotated for Teacher and Student Discursive Moves](https://aclanthology.org/2022.lrec-1.497/). *Proceedings of the Thirteenth Language Resources and Evaluation Conference*, pages 4654–4662. European Language Resources Association.

The paper describes **567 transcripts**, including partial lessons. This is the source corpus size, not automatically the denominator of a particular analysis. Our downloaded snapshot also contains 191 lesson workbooks in `Subset 1` and 376 in `Subset 2`.

## Snapshot and files

The download is pinned to upstream commit [`869b9406de268ebab0f1b9a3bccde0b416b97290`](https://github.com/SumnerLab/TalkMoves/tree/869b9406de268ebab0f1b9a3bccde0b416b97290), retrieved on 2026-10-25 UTC. [source_manifest.json](results/source_manifest.json) records the archive SHA-256, retrieval time, and each downloaded file's checksum and size.

| Source file | Parsed data rows, excluding header | Empty target sentences |
|---|---:|---:|
| `data/train_teacher.tsv` | 150,918 | 274 |
| `data/test_teacher.tsv` | 23,250 | 42 |

These are CSV-parser counts from the pinned files, not line counts or the example counts in the project brief. We drop only empty or whitespace-only target sentences, retaining **150,644 training** and **23,208 test** pairs. Empty context is retained; a literal word such as “None” is not treated as missing.

Raw downloads live under `data/raw/talkmoves/` and are ignored by Git. The TSVs contain `text_a`, `text_b`, and numeric class IDs in `labels`. We use the supplied context in `text_a` and the target teacher sentence in `text_b`. The upstream [preprocessing notebook](https://github.com/SumnerLab/TalkMoves/blob/869b9406de268ebab0f1b9a3bccde0b416b97290/code/load_and_clean_data.ipynb) constructs teacher context from a preceding student sentence, or an empty string when there is none. The runtime coach instead uses the previous presenter sentence; this difference limits transfer.

## Teacher labels

IDs below are the seven-class teacher TSV encoding; workbook tags have a separate encoding, handled by the benchmark script. Definitions are paraphrases of the upstream [coding manual](https://github.com/SumnerLab/TalkMoves/blob/869b9406de268ebab0f1b9a3bccde0b416b97290/Coding%20Manual.pdf).

| TSV ID | Label | Meaning | Report label |
|---|---|---|---|
| 0 | None | No annotated teacher move | Not displayed |
| 1 | Keeping everyone together | Engage listeners and orient the group | Checking in with the room |
| 2 | Getting students to relate | Invite responses to another learner's contribution | Connecting ideas |
| 3 | Restating | Repeat a learner's words | Excluded |
| 4 | Revoicing | Reformulate or extend a learner's contribution | Excluded |
| 5 | Pressing for accuracy | Elicit precise mathematical contributions or vocabulary | Asking for precision |
| 6 | Pressing for reasoning | Ask for explanations, evidence, or justification | Asking why |

“Connecting ideas” is a short product label for relating learners' contributions, not a measure of every kind of conceptual connection. All seven classes are learned and evaluated; the product exposes only the four selected moves. Restating and revoicing are withheld because their measured F1 is below 0.35; “None” remains in the denominator.

## Processing and reproduction

From the repository root:

```bash
bash data/scripts/fetch_talkmoves.sh
cd apps/api
uv sync --extra data
uv run --extra data --with matplotlib==3.10.7 --with openpyxl==3.1.5 python ../../data/scripts/train_talkmoves.py
uv run --extra data --with matplotlib==3.10.7 --with openpyxl==3.1.5 python ../../data/scripts/benchmarks.py
uv run --extra data python verify.py
```

Training concatenates the supplied context, ` [SEP] `, and teacher sentence. TF-IDF supplies lowercased word unigrams and bigrams, sublinear term frequency, and at most 60,000 features. Class-balanced logistic regression chooses C from 1, 2, and 4 using a seeded, stratified 10% validation split of the official training file; the selected pipeline is refitted on all retained training pairs and evaluated once on the retained official test pairs. No user sessions enter training. The retained test score is 73.23% accuracy and 0.5350 seven-class macro-F1; see the measured table and overlap audit in the methods document. The separate lesson benchmarks use human labels in native lesson workbooks, not classifier predictions or TSV row counts. **566 of the 567 native workbooks are eligible**, contributing 175,073 nonblank teacher sentences; one has no eligible teacher rows. Valid student tags take precedence over overlapping teacher tags, removing 73 dual-tag rows. The methods document records tag exclusions, bootstrap inference, and the resulting medians.

## Permissions, privacy, and limitations

The upstream dataset is [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/): attribute the source, indicate changes, retain the license, use it noncommercially, and share adaptations under the same terms. Our changes are the text representation, fitted classifier, evaluation, and aggregate benchmarks. Raw classroom files and classroom excerpts are not redistributed in this repository; use the fetch script to obtain the original release. This is a noncommercial hackathon/research use, not a claim of unrestricted commercial permission.

The [source paper, sections 3.2.2 and 4.2–4.3](https://aclanthology.org/2022.lrec-1.497.pdf), distinguishes anonymized TalkBack names from names retained in some public-source transcripts; the entire corpus must not be described as de-identified. It also describes a predominantly U.S. sample with international TIMSS material. These are not representative college-presentation norms. Sparse labels, missing context, inconsistent transcription, and automated speech-recognition errors can change results. After normalizing case and whitespace, 3,401 of 23,208 test pairs also appear in training; this text overlap can inflate apparent generalization and limits conclusions about new lessons. Human-coded classroom rates and model-predicted rehearsal rates have different error sources, so a higher rate is not evidence of better teaching. Read the [ethics statement](../docs/data-science.md#ethics-statement) before reusing the analysis.
