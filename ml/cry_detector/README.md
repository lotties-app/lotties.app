# ml/cry_detector: on-device cry detection spike (evaluation harness)

Research spike, not product code. Question: can Lotties detect "a baby is crying" on the device, in the browser, from
the microphone, reliably and cheaply enough to auto-start a `fussy` event? Report and recommendation:
[`docs/design/31-cry-detector-spike.md`](../../docs/design/31-cry-detector-spike.md).

This harness never opens a microphone and never records anything. It scores public dataset clips and synthetic
audio, composes simulated 24 h days from those scores and runs the sustained-cry trigger over them.

## Data rules

- Datasets and models are downloaded into a cache directory **outside the repository** (`--cache` or
  `BR_CRY_CACHE`; `fetch` refuses a path inside the repository). Never commit audio, models or derived files.
- Downloads are pinned (URL, commit, SHA-256 in `cry_detector/sources.py`) and treated as untrusted data: archives are
  extracted with path checks, nothing from them is executed.
- ESC-50 is CC BY-NC 3.0: evaluation only, never redistributed. Donate-a-cry contains real infant recordings
  published by its authors under ODbL/DbCL: used for evaluation only, never copied into the repository, logs or docs.
- Outputs (`--out`) hold aggregates only: no audio, no per-clip rows, no file names.

## Setup

Python 3.12 (MediaPipe 1.1.1 has no wheel for newer versions on every platform); `uv` recommended.

```bash
cd ml/cry_detector
uv venv --python 3.12 .venv
uv pip install --python .venv -e ".[yamnet,ast,dev]"
```

## Run

```powershell
cd ml/cry_detector
$env:BR_CRY_CACHE = "C:\path\outside\the\repo\cry-cache"
.venv\Scripts\python.exe -I -m cry_detector.fetch                     # 850 MB: ESC-50, Donate-a-cry, Mini LibriSpeech, YAMNet, AST
.venv\Scripts\python.exe -I -m cry_detector.evaluate --out out\full    # about 60-90 min on a desktop CPU
.venv\Scripts\python.exe -I -m cry_detector.evaluate --out out\quick --quick   # smoke run, about 10 min
.venv\Scripts\python.exe -m pytest                                     # unit tests, no data needed
```

### Web trigger vectors

`code/web/src/cry/trigger.ts` is a streaming port of `cry_detector/trigger.py`. After any change to the trigger,
regenerate the shared vectors (synthetic scores only, no data needed) and commit the JSON:

```powershell
.venv\Scripts\python.exe -m cry_detector.make_vectors           # writes code/web/src/cry/cryTriggerVectors.json
.venv\Scripts\python.exe -m cry_detector.make_vectors --check   # exit 1 when the committed file is stale (pytest runs it too)
```

The vitest `code/web/src/cry/trigger.test.ts` runs the TypeScript trigger over every case and expects the same events.

Bash: the same with `export BR_CRY_CACHE=...` and `.venv/bin/python`. Options: `--skip-ast` (no AST clip-level
comparison, saves about 20 minutes), `--rebuild` (re-score the cached libraries after a code change),
`--positive-days`, `--negative-days`, `--seed`.

What `evaluate` does:

1. Splits every corpus by recording group (ESC-50 folds 1-2 / 3 / 4-5; Donate-a-cry app instance and LibriSpeech
   speaker hashed 50/20/30 into train / val / test).
2. Scores train windows (cry clips over random beds and SNRs, negatives) with YAMNet and the baseline features, fits
   the YAMNet head and the baseline logistic regression.
3. Renders and scores a validation and a test library: cry episodes (1-10 min, built from clips with breath gaps and
   pauses) in 14 acoustic conditions, negative stretches (speech, synthetic music, five ESC-50 groups) over four beds,
   and the beds alone.
4. Composes 24 h days (8 episodes a day; negative days per bed and mix; "household" days with both) and sweeps the
   trigger (threshold, N, M, smoothing; Q = 180 s) on the validation days, picks the defaults and the three
   sensitivity levels, then reports them on the test days.
5. Window metrics (ROC AUC, AP, F1), confusion by category, and a clip-level comparison including AST.

## Browser runtime bench

Measures load time, per-inference time, CPU duty cycle and memory of YAMNet (MediaPipe Tasks Audio, WASM) and AST
(Transformers.js, onnxruntime-web WASM) in headless Chromium, and checks that the browser scores equal the Python
ones. JS packages go into a scratch directory outside the repository (never into `code/web`):

```bash
SCRATCH=/path/outside/the/repo/cry-bench
mkdir -p $SCRATCH/hf && cd $SCRATCH && npm init -y && npm install @mediapipe/tasks-audio@1.1.1 @huggingface/transformers@4.3.1
curl -L -o $SCRATCH/hf/preprocessor_config.json https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593/resolve/249a1fbf0286b40e7f1ed687a8ae396997bf7dc6/preprocessor_config.json
cd <repo>/ml/cry_detector
.venv/Scripts/python.exe -I -m cry_detector.parity write --dir $SCRATCH/signals
node browser/bench.mjs --scratch $SCRATCH --cache $BR_CRY_CACHE --playwright <a playwright package dir, e.g. the main clone's tests/e2e/node_modules/playwright> --out $SCRATCH/bench.json
.venv/Scripts/python.exe -I -m cry_detector.parity compare --dir $SCRATCH/signals --browser $SCRATCH/bench.json
```

The bench serves files on `127.0.0.1:18431` only, with COOP/COEP headers (threads for onnxruntime-web), and opens no
microphone.

## Layout

| Module | Role |
|---|---|
| `cry_detector/sources.py`, `fetch.py` | Pinned sources (URL, commit, SHA-256, licence), download, checksum and content digest, safe extraction |
| `cry_detector/corpus.py` | Clip inventory, group splits, 16 kHz loading |
| `cry_detector/audio.py` | Levels (active RMS), beds (room tone, white, pink, fan), synthetic music, another-room filter |
| `cry_detector/features.py` | Energy and spectral baseline features per 0.975 s window |
| `cry_detector/ast_features.py` | AST Kaldi filter bank in numpy (same as the numpy / Transformers.js extractor) |
| `cry_detector/scorers.py` | YAMNet (MediaPipe), cry scores, logistic head, AST (onnxruntime) |
| `cry_detector/library.py` | Positive conditions, episode and negative rendering, the scored library, training windows |
| `cry_detector/simulate.py` | 24 h day composition, mixes, false-alarm attribution |
| `cry_detector/trigger.py` | The sustained-cry trigger (pure, causal) |
| `cry_detector/make_vectors.py` | Shared trigger vectors for the web port (`code/web/src/cry/cryTriggerVectors.json`) |
| `cry_detector/metrics.py` | Window metrics, episode matching, summaries |
| `cry_detector/evaluate.py` | CLI: everything above, `results.json` and `results.md` |
| `cry_detector/parity.py` | Python side of the browser parity check |
| `browser/bench.html`, `bench-page.js`, `bench.mjs` | Headless Chromium runtime bench |
| `tests/` | Trigger logic on synthetic scores, day composition, acoustics, features, filter bank |
