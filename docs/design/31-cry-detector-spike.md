# On-device cry detection: research spike (2026-10-23)

Status: research spike. Deliverable: this report and the reproducible harness in `ml/cry_detector/` (README there).
No product UI, no API change, no migration. No audio was recorded; no real home audio exists in this work.

Question: can Lotties detect "a baby is crying" on the device, in the web app (PWA, later the Capacitor shell), from
the microphone, with acceptable false alarms and misses, a small model and a low CPU and battery cost, so that a
sustained cry auto-starts a `fussy` event and notifies the parents? Detection only, never the cause (the cause stays
with "Why is she crying?", docs/design/27-cry-reasons.md). No audio is ever stored or uploaded; only the event leaves
the device.

## 0. Recommendation

**GO-WITH-CONDITIONS** for a foreground "cry monitor" mode in the PWA, built on **YAMNet through MediaPipe Tasks
Audio** with its own "Baby cry, infant cry" score (zero-shot, no training of ours) and a sustained-cry trigger.
**NO-GO** for the Transformers.js Audio Spectrogram Transformer (more accurate per clip, but 65 to 130 times the
compute and a 120 MB download) and for the energy + spectral baseline (misses half the cries). **NO-GO for background listening in the web app**:
the platforms stop the microphone when the screen locks or the page is hidden; that needs the native shell and its
own go/no-go.

Key numbers (synthetic test days, defaults chosen on separate validation days; section 4, limits in section 9):

| | YAMNet zero-shot, standard default |
|---|---|
| Rule | score of class 20, causal mean of 3 windows >= **0.02**; start when >= **20 s of the last 60 s** are over it; end after **3 min** quiet |
| Cry episodes (1-10 min) detected, phone in the baby's room (quiet, or white/pink/fan noise at 10 and 5 dB SNR, and the realistic household days) | **524 of 528 (99.2 %, 95 % CI 98.1-99.7 %)** |
| Same at 0 dB SNR / next room, door open / closed door | 93.8 % / 84.4 % / **8.3 %** |
| False alarms per 24 h | **0 in 216 simulated days**: 36 household days (95 % upper bound 0.08 a day) and 84 one-type stress days with hundreds of dogs, cats, laughter, speech, music, sirens, appliances (upper bound 0.04 a day) |
| Detection latency | median 29 s (22 s quiet room, 44 s over white noise), `started_at` within 0-6 s of the true start (median) |
| Size / runtime | 4.1 MB model + 6.7 MB WASM (5.4 MB gzip), 0.2 s load, 4.5-8.7 ms per 0.975 s of audio: **1 % of one desktop core**, about 5-9 % on a low-end phone (estimate), +69 MB memory |

Conditions of the GO:

1. **Scope**: foreground monitor mode on a spare, plugged-in phone or tablet in the baby's room, screen on (Wake
   Lock; iOS 18.4+ for installed web apps). Never presented as background listening; never as a baby monitor or a
   safety device (text in section 8). Native background listening is a separate spike (CD10).
2. **Opt-in beta**, off by default, per device, behind the consent screen; Owner/Parent/Caregiver only.
3. **Real-world validation before it leaves beta** (section 10): a pilot with consenting families with the
   "Yes, crying / Not crying" feedback, and device tests. The synthetic margin is narrow: false alarms appear at
   threshold 0.005 and in-room detection drops below 95 % at 0.03, so the threshold must be checked on real phones.
4. **Owner decisions**: licence flags C1 (minor) and C2 (do not ship our trained head as is), the consent text and a
   legal read (LGPD art. 14, ECA Digital), and the new push kind off by default.

Doubts worth stating up front: laughter is the main false-alarm source once the threshold is lowered (and baby
laughter, TV audio with babies and siblings crying are not in any dataset used here); a cry in another room behind a
closed door is almost never detected by the zero-shot score; the cry corpus is small and 8 kHz. The small trained
head on top of YAMNet (`yamnet_head`, 522 numbers) catches closed-door crying too (94.8 %) with no false alarms, but
part of that gain comes from learning this simulator's wall filter, and it is trained on non-commercial data: a
phase-2 option after the pilot, not the default.

## 1. Candidates (models and runtimes)

AudioSet ontology classes that matter here (YAMNet indices; AST uses the same names, 527 classes): 19 "Crying,
sobbing", 20 "Baby cry, infant cry", 21 "Whimper", 22 "Wail, moan", 14 "Baby laughter", 13 "Laughter", 11
"Screaming", 10 "Children shouting", 66 "Children playing", 0 "Speech", 1 "Child speech, kid speaking", 78 "Meow",
132 "Music", 494 "Silence".

| Candidate | Runtime in the browser | Files (raw / gzip) | Licence | Load (this PC) | Per inference | Evaluated |
|---|---|---|---|---|---|---|
| **YAMNet via MediaPipe Tasks Audio** | `@mediapipe/tasks-audio` 1.1.1 (WASM + XNNPACK, SIMD), `AudioClassifier`, 15600-sample windows (0.975 s, 16 kHz; the task resamples) | `yamnet.tflite` 4,126,810 B (sha256 `4d8b4a53...4faf`) + `audio_wasm_internal.wasm` 6,707,047 B + JS 316 kB = 11.1 MB / 5.4 MB gzip | Package Apache-2.0; YAMNet Apache 2.0 (tensorflow/models `research/`; Google's Kaggle model page lists every YAMNet variant, TF2, TFLite, TF.js and Coral, as Apache 2.0); the MediaPipe model page itself names no licence (flag C1, minor) | 0.2 s | 4.5 ms per 0.975 s (8.7 ms from 48 kHz) | yes: zero-shot (`yamnet_baby`, `yamnet_cry`) and with a trained 521-weight head (`yamnet_head`) |
| YAMNet via TensorFlow.js or onnxruntime-web | TF.js graph model from Kaggle/TF Hub, or a converted ONNX | TF.js core + WASM backend about 3-4 MB plus the model | Apache-2.0 | not measured | not measured | no: same network as MediaPipe, more glue code; MediaPipe gives resampling and framing for free and exact Python parity |
| **AST via Transformers.js** | `@huggingface/transformers` 4.3.1 + onnxruntime-web 1.31 (WASM; WebGPU possible), `Xenova/ast-finetuned-audioset-10-10-0.4593` int8 | `model_quantized.onnx` 90,807,386 B (sha256 `807d244b...7f61`) + the WebGPU-capable ORT WASM build that Transformers.js web imports, 28.4 MB (the plain one is 14.3 MB) + JS 0.6 MB = about 120 MB / 73 MB gzip | Transformers.js Apache-2.0, onnxruntime-web MIT, AST weights BSD-3-Clause (MIT/ast model card) | 1.6 s | 6.0 s per 10.24 s, 1 thread (1.75 s, 4 threads) | yes, clip level only (too slow for continuous use, section 5) |
| CNN14 / PANNs, BEATs, EfficientAT distillations | onnxruntime-web after a PyTorch export | CNN14 about 300 MB; EfficientAT mn04 to mn10 about 2-20 MB | PANNs MIT code, weights on Zenodo; EfficientAT MIT | - | - | no: no maintained browser build; running their export code means running downloaded code (spike rule), and YAMNet already meets the bar |
| **Energy + spectral baseline** | 14 hand-made features per 0.975 s window (band energies 50-250, 250-700, 1000-5000 Hz, ratios, flatness, centroid, voicing in a 250-700 Hz pitch range, energy spread) + logistic regression | a few kB of code and 15 weights | ours (AGPL) | 0 | about 2 ms per window in numpy | yes, as the lower bound |

How the YAMNet one loads in a page: `FilesetResolver.forAudioTasks(<url of the package's wasm folder>)`, then
`AudioClassifier.createFromOptions(fileset, { baseOptions: { modelAssetPath: <yamnet.tflite url> }, maxResults: -1 })`;
both files can be self-hosted next to the app (no CDN, no third party at run time) and precached by the service worker.
`classify(float32Samples, sampleRate)` is synchronous; Google's guide says to call it from a web worker so the UI never
blocks.

## 2. Datasets (licences checked before use)

| Dataset | What | Licence and terms | Used for | Obtained |
|---|---|---|---|---|
| ESC-50 (Piczak 2015), commit `33c8ce9e`, zip sha256 `661183a6...a21f` | 2000 clips of 5 s, 50 classes, 5 folds, 44.1 kHz; class `crying_baby` (40 clips) | **CC BY-NC 3.0** for the dataset (ESC-10 subset CC BY 3.0); per-clip Freesound licences in its LICENSE | 40 cry clips (positives), 1960 clips of 49 classes as hard negatives in five groups (animals, natural, human non-speech, domestic, urban) | yes |
| Donate-a-cry corpus (gveres/donateacry-corpus), commit `6baf5aca`, zip sha256 `c8a817fc...8d27` | 457 cleaned infant cry clips, about 7 s, **8 kHz**, tagged by the uploading parents (hungry 382, discomfort 27, tired 24, belly pain 16, burping 8) | **ODbL 1.0** (database) + **DbCL 1.0** (contents); the authors ask users to drop them a line | positives (cry episodes) | yes |
| Mini LibriSpeech dev-clean-2 (OpenSLR 31), sha256 `176ec501...8012` | 1089 utterances of adult read speech, 16 kHz | **CC BY 4.0** | speech negatives (conversation in the room) | yes |
| AudioSet "Baby cry, infant cry" segments | YouTube ids + labels (CC BY 4.0) | the audio is only obtainable by downloading YouTube videos, which YouTube's terms do not allow | - | **no, skipped** |
| UrbanSound8K (`children_playing`) | 8732 urban clips | CC BY-NC 3.0, 6 GB | would add screaming kids | not used (size; noted as a gap) |
| TV, film, radio audio | - | no licensed source | - | **not evaluated** (a real gap: TV shows contain crying babies) |
| Synthetic | room tone, white, pink, fan (60 Hz mains harmonics), tonal music with vibrato in the cry pitch range (lullaby to pop, with or without drums), wall and open-door filters, reverb | ours | beds, music negatives, acoustic conditions | generated, seeded |

Every download is pinned in `ml/cry_detector/cry_detector/sources.py` (URL with a commit, SHA-256 of the archive, and
a content digest over the audio files, which stays valid when GitHub regenerates an archive), lives in a cache
directory outside the repository and is extracted with path checks; nothing from it is executed. The non-commercial
ESC-50 licence affects only this evaluation (no redistribution, no shipping): nothing from ESC-50 would ship.
Donate-a-cry is real infant audio published by its authors; it was only scored locally and nothing derived from it is
in the repository.

## 3. Method

**Splits** (leak-free, by recording group): ESC-50 folds 1-2 train, 3 validation, 4-5 test (its folds keep clips of
one Freesound recording together); Donate-a-cry by app-instance id (one installed app, usually one family) and
LibriSpeech by speaker, hashed 50/20/30. Train windows fit the YAMNet head and the baseline; validation days choose
the trigger defaults; every number below is on test clips and test days unless it says "val".

**Levels** (active RMS in dBFS): a cry near the phone (about 1 m) at -35; noise beds at -45 / -40 / -35 give 10 / 5 /
0 dB SNR; a quiet room at -75 (room tone); the next room with the door open at -50 with reverb; another room behind a
closed door at -55 through a wall filter (6 dB/octave above 400 Hz, steeper above 2.5 kHz) with reverb. Negatives
play at their own levels over the bed (ESC-50 events -45 to -25, speech -42 to -30, music -45 to -30).

**Cry episodes**: 1 to 10 min (log-uniform), built from test cry clips in random order, 0.2-1.2 s breath gaps and a 3-12
s pause every 30-90 s; two thirds from Donate-a-cry, one third from ESC-50. The same 24 episodes are rendered in 14
conditions (quiet near; white, pink and fan beds at 10, 5, 0 dB; door open over quiet and over fan; closed door over
quiet and over fan), so the conditions compare like for like. Window label: cry when at least 30 % of the window is
active cry; pauses inside an episode count as neither.

**Negatives**: bursts of 1-6 clips of one ESC-50 class (5-30 s: a dog barking for a while, a vacuum, laughter),
speech stretches of 0.5-4 min from 1-3 speakers, synthetic music of 0.5-4 min, each over each bed (room tone and the
three noise beds at -40).

**Days**: every library item is scored once as one piece of audio with 2 s of its bed on each side; a 24 h day is a
sequence of items separated by slices of its scored bed (88,615 windows of 0.975 s). Positive days: 8 episodes of one
condition, at least 10 min apart. Negative days: per bed, one mix: `household` (a guess at a busy day with a baby: 40
speech and 15 music stretches, 120 domestic, 60 human, 20 animal, 20 natural and 30 urban bursts, Poisson counts) or
a stress day of one type (200 speech or 150 music stretches, or 400 bursts of one ESC-50 group: many times a real
day, to estimate a rate per type). Realistic days: 8 episodes plus the household mix on each bed. Test: 84 positive
days (14 conditions x 6), 108 negative days (4 beds x 9 mixes x 3) and 24 realistic days = 216 days and 864 episodes,
from a library of 1388 scored items (45 h of audio); validation: 126 days from a separate, smaller library built from
validation clips.

**Trigger** (`ml/cry_detector/cry_detector/trigger.py`, unit-tested): window score, causal moving average over
`smooth` windows, active when >= T; a cry starts when at least N seconds of the last M seconds are active (decision
at the end of that window; `started_at` = start of the first active window inside the M seconds); it ends after Q =
180 s without an active window (`ended_at` = end of the last active window). An episode is detected when a trigger
fires between its start and its end (+ 4 windows of lag); any other trigger is a false alarm.

**Selection** (on validation days only): sweep T (29 values, 0.002-0.995), N (10, 15, 20, 30 s), M (30, 60 s),
smoothing (1, 3 windows), Q fixed at 180 s; keep rules with N of 20 or 30 s ("sustained", as the brief asks) and at
most 0.5 false alarms per 24 h on household days; among them, detection within 1 point of the best over the in-room
conditions (the monitor is in the baby's room: quiet near, 10 and 5 dB SNR, realistic days), then the fewest
stress-day false alarms, then the highest threshold (margin), then the lowest latency. Sensitivity levels keep N, M and smoothing and move T only: **high** = the most detections over all
conditions with at most 2 household false alarms per 24 h; **low** = the highest T that still catches 95 % of near
cries.

**Browser parity**: the same signals scored by MediaPipe in Python and by `@mediapipe/tasks-audio` in headless
Chromium give the same YAMNet scores (largest difference 5e-7 over 40 windows of two cry clips, speech, a dog, pink
noise and music), so every YAMNet number here holds for the web build. AST's baby-cry logit agrees within 0.07 (int8
kernels and our numpy port of its filter bank).

## 4. Results

All on test clips and test days (216 days, 864 episodes; 45 h of scored test audio), with the trigger chosen on
the 126 validation days. Full tables: `results.md` of the run (aggregates only, not committed); the run is
reproducible with the seeds in the harness.

### 4.1 Product metric at the standard defaults

"In-room" = the monitor is in the baby's room: quiet near, white/pink/fan beds at 10 and 5 dB SNR, and the realistic
household days (11 conditions, 528 episodes). False alarms: household days = the household mix on each bed plus the
realistic days (36 days); stress days = one negative type many times a real day (84 days); the 96 bed-only days had
no false alarm for any model.

| Detector (rule) | In-room detected | 0 dB SNR | Door open | Closed door | FA / 24 h household (upper 95 %) | FA / 24 h stress (upper 95 %) | Latency median |
|---|---|---|---|---|---|---|---|
| **YAMNet zero-shot** `yamnet_baby` (T 0.02, smooth 3, N 20 s of M 60 s) | 524/528, 99.2 % (98.1-99.7) | 135/144, 93.8 % | 81/96, 84.4 % | 8/96, 8.3 % | 0 (0.08) | 0 (0.04) | 29 s |
| YAMNet "crying" `yamnet_cry` = max(classes 19, 20) (T 0.03, smooth 3, 20 of 60 s) | 524/528, 99.2 % | 129/144, 89.6 % | 91/96, 94.8 % | 22/96, 22.9 % | 0.44 (0.68) | 0.38 (0.51) | 27 s |
| YAMNet + trained head `yamnet_head` (T 0.995, smooth 1, 20 of 60 s) | 522/528, 98.9 % (97.5-99.5) | 139/144, 96.5 % | 96/96, 100 % | 91/96, 94.8 % | 0 (0.08) | 0 (0.04) | 37 s |
| Energy + spectral baseline (T 0.9, smooth 1, 20 of 60 s) | 253/528, 47.9 % | 5/144, 3.5 % | 69/96, 71.9 % | 48/96, 50 % | 0.97 (1.29) | 1.33 (1.56) | 58 s |

All 48 false alarms of `yamnet_cry` came from laughter ("Crying, sobbing" reacts to it); the baseline's from music
(71), laughter (38) and church bells (32). With the rule fixed at N 20 s of M 30 s and no smoothing (each model at
its own best threshold), zero-shot YAMNet does worse (96.8 % in-room, 0.44 false alarms per household day), so the
smoothing and the 60 s window matter. Allowing N = 10 s (of M = 30 s, threshold 0.05) would cut the median latency to
19 s at 97.7 % in-room detection and no false alarm, but it is less of a "sustained" cry; the default keeps 20 s.

**YAMNet zero-shot per condition** (48 episodes each; latency = trigger time minus episode start):

| Condition | Detected | Latency median / p90 | `started_at` error median |
|---|---|---|---|
| Quiet room, near | 48 | 22 / 39 s | 0 s |
| Fan 10 / 5 / 0 dB | 48 / 48 / 48 | 22 / 23 / 23 s (p90 32-36 s) | 0 s |
| Pink 10 / 5 / 0 dB | 48 / 48 / 43 | 32 / 36 / 48 s (p90 48-115 s) | 1-3 s |
| White 10 / 5 / 0 dB | 48 / 47 / 44 | 35 / 44 / 60 s (p90 52-110 s) | 2-3 s |
| Realistic days: quiet / fan / pink / white | 48 / 48 / 48 / 45 | 23 / 23 / 37 / 46 s | 0-6 s |
| Door open: quiet / fan | 33 / 48 | 37 / 33 s (p90 291 / 49 s) | 10 / 1 s |
| Closed door: quiet / fan | 0 / 8 | - / 98 s | - / 50 s |

White noise (a common white-noise machine) is the hardest bed; a faint cry over a silent room (door open, quiet) is
missed more often than the same cry over a fan, a sign that YAMNet's score depends on the absolute level (worth a
fixed input gain experiment in the build phase). No episode was split into two events.

### 4.2 Sensitivity levels (zero-shot; same smoothing, N and M, threshold only)

| Level | Threshold | In-room | All conditions | Near only | FA / 24 h household | FA / 24 h stress | Latency median |
|---|---|---|---|---|---|---|---|
| High (most detections with at most 2 household false alarms a day, validation) | 0.002 | 100 % | 97.5 % | 100 % | 0.75 | 0.83 | 22 s |
| **Standard** | **0.02** | 99.2 % | 86.6 % | 100 % | 0 | 0 | 29 s |
| Low (highest threshold that still catches 95 % of near cries, validation) | 0.05 | 92.0 % | 72.5 % | 96.7 % | 0 | 0 | 37 s |

Validation trade-off for the standard rule: threshold 0.002 / 0.005 / 0.01 / 0.02 / 0.03 / 0.05 / 0.1 gives in-room
detection 100 / 100 / 100 / 100 / 96.2 / 91.7 / 77.3 % and household false alarms 0.55 / 0 / 0 / 0 / 0 / 0 / 0 per day
(stress days 0.91 / 0.09 / 0 / 0 / 0 / 0 / 0). On the test days, 0.005 gave 0.44 household and 0.42 stress false alarms
a day and 0.01 gave 0 and 0.04: the safe band is narrow (section 0, condition 3).

### 4.3 What it confuses

- **False alarms at the high level** (zero-shot, 0.002, test days): laughter 86 of 97, coughing 3, cows 2, then one
  each of washing machine, snoring, breathing, cat, creaking door. At 0.01: laughter 2, creaking door 1. Speech, music,
  dogs, sirens, vacuum cleaners and the noise beds never triggered a zero-shot model.
- **Windows over the standard threshold** (single windows, before the sustained rule): laughter 7.6 % of its windows,
  creaking doors 7.3 %, cats 3.5 %, breathing 2.8 %, pigs 1.8 %, sneezing 1.4 %; the 99th-percentile score of creaking
  doors (0.12), laughter (0.08) and cats (0.06) is above the threshold. The sustained rule is what keeps them out: a
  minute of laughter or a meowing cat next to the phone would trigger.
- **Missed cry windows** (zero-shot): YAMNet's top class for them is Speech 27 %, Silence 19 %, Animal 17 %, Cat 7 %,
  pets 6 %, Pink noise 3 %, Music 3 %.
- Not testable here: **baby laughter and cooing**, siblings and other children crying or screaming, TV audio, a
  parent singing. YAMNet has a "Baby laughter" class (14), which a later version could use as a veto.

### 4.4 Window metrics (all test windows, all conditions)

| Model | ROC AUC | Average precision | Best F1 | At the standard threshold: precision / recall / false-positive rate |
|---|---|---|---|---|
| YAMNet zero-shot | 0.835 | 0.842 | 0.80 | 0.997 / 0.42 / 0.14 % |
| YAMNet "crying" | 0.879 | 0.884 | 0.86 | 0.994 / 0.50 / 0.32 % |
| YAMNet + head | 0.963 | 0.972 | 0.92 | 0.994 / 0.55 / 0.37 % |
| Baseline | 0.866 | 0.864 | 0.82 | 0.931 / 0.28 / 2.28 % |

The window recall is low (many cry windows inside an episode are breaths, whimpers or faint), which is why the
product decision is per episode, not per window. Zero-shot ROC AUC by condition: quiet near 0.91, fan 0.93, pink and
white 0.81-0.88, door open 0.79-0.85, closed door 0.60-0.66 (the head: 0.95-0.98 everywhere).

### 4.5 Clip level, with AST (1061 test clips, 127 cries; one score per clip)

| Model | ROC AUC quiet / fan 5 dB | Average precision quiet / fan | False-positive clips at 90 % recall (of 934), quiet | Top false-positive categories |
|---|---|---|---|---|
| AST `ast_baby` | 0.997 / 0.997 | 0.985 / 0.986 | 7 | laughing 6, door creaks 1 |
| YAMNet zero-shot | 0.985 / 0.986 | 0.939 / 0.950 | 22 | door creaks 4, cat 4, frog 4, laughing 3, pig 2 |
| YAMNet + head | 0.994 / 0.990 | 0.941 / 0.921 | 14 | cat 3, door creaks 2, rooster 2 |
| Baseline | 0.926 / 0.898 | 0.543 / 0.431 | 141 | rooster 16, siren 14, laughing 11, dog 10, church bells 9, speech 9 |

AST is the better classifier per clip (a third of YAMNet's false positives), but section 5 rules it out on cost; the
sustained trigger closes most of the gap for YAMNet. AST's errors are laughter too.

## 5. Runtime in the browser (this PC) and on phones (estimate)

Measured with `ml/cry_detector/browser/bench.mjs`: headless Chromium 156 (Playwright), Windows 11, AMD Ryzen 9 5900X,
files served from 127.0.0.1 (so load times exclude the network), 2026-10-23. The evaluation ran on one other core at
the same time.

| | YAMNet (MediaPipe Tasks Audio 1.1.1, WASM) | AST (Transformers.js 4.3.1, onnxruntime-web WASM, int8) |
|---|---|---|
| Download (first use, then cached) | 11.1 MB raw, 5.4 MB gzip (model 4.1 MB, WASM 6.7 MB, JS 0.3 MB) | about 120 MB raw, 73 MB gzip (model 90.8 MB, the WebGPU-capable ORT WASM build 28.4 MB that Transformers.js web imports, JS 0.6 MB) |
| Load (WASM compile + model) | 197 ms cold, 186 ms in a second context | 1.6 s |
| One inference | 4.5 ms per 0.975 s window at 16 kHz input (p95 5.9 ms); 8.7 ms with 48 kHz input (the task resamples) | 6.0 s per 10.24 s window, 1 thread; 1.75 s with 4 threads |
| Continuous real time (one window per 0.975 s, 48 kHz input, 30 s) | **1.0 % of one core** (in-page busy time); renderer CPU 1.2 % of one core | about 59 % of one core with 1 thread at a 10 s hop (not run continuously) |
| CPU throttled (Chrome DevTools 4x and 6x, a rough stand-in for a slow phone) | 44 ms and 76 ms per window (4.5 % and 7.8 % duty) | - |
| Memory (renderer working set, after load minus before) | +69 MB (private +64 MB) | +340 MB (private +350 MB) |
| Parity with Python | equal scores (largest difference 5e-7) | baby-cry logit within 0.07 |

**Phones (estimate, not measured).** A low-end Android phone (Helio G85 / Snapdragon 6xx class) is roughly 5-10 times
slower than this desktop core in single-thread WASM, an iPhone 11 class about 1.5-2.5 times (from public browser and
CPU benchmark ratios; uncertainty easily a factor of 2). YAMNet would then take about 45-90 ms per 0.975 s on the
low-end phone (5-9 % of one core) and 15-25 ms on the iPhone; even a 20-times-slower device stays under 20 %. Feeding
16 kHz audio (an `AudioContext({ sampleRate: 16000 })` or our own resampler in the worklet) halves it. AST would take
30-60 s per 10 s window on the low-end phone with one thread: it cannot keep up, and 4 threads on a phone would heat it
and drain it. **AST is ruled out for continuous use**; it is kept here only as an accuracy reference.

**Battery (estimate).** In the PWA the screen must stay on (Wake Lock), and the screen dominates: about 0.3-0.6 W at
minimum brightness, plus the microphone and audio path (about 0.05-0.1 W) and the classifier (5-10 % of a small core,
about 0.05-0.15 W). That is about 0.4-0.85 W, or 4-8.5 Wh over a 10 h night, against 11-15 Wh in a typical phone
battery: **monitor mode needs the charger**. A native build with the screen off might need 0.15-0.3 W (10-25 % of a
battery per night); to be measured in CD8. Memory (about 70 MB) is fine even on a 2 GB phone.

## 6. Web platform constraints (sources accessed 2026-10-23)

VERIFIED = read on the cited page; UNVERIFIED = secondary source or the page could not be read. Desk research, not a
device test: every line needs a check on real devices in the build phase.

| Topic | Finding | Source |
|---|---|---|
| HTTPS | `getUserMedia` needs a secure context (HTTPS or localhost); otherwise `navigator.mediaDevices` is undefined. VERIFIED | MDN MediaDevices.getUserMedia |
| iOS installed PWA | the microphone works in a Home Screen web app since iOS 13.4 (WebKit bug 185448, from the bug comments). VERIFIED. An Apple engineer said in August 2025 that `getUserMedia` has been inconsistent in PWAs (records on first launch, not after relaunch). VERIFIED. Whether the permission persists between launches: UNVERIFIED | bugs.webkit.org/show_bug.cgi?id=185448, developer.apple.com/forums/thread/797987, bugs.webkit.org/show_bug.cgi?id=208667 |
| Screen lock / background, iOS | WebKit mutes capture when the page is hidden unless the host app has `UIBackgroundModes` `audio` (WebKit source); a Home Screen web app does not, so the microphone stops when the screen locks or the app goes to the background (bug 239602 says so; page unreadable: UNVERIFIED for the bug, VERIFIED for the source) | WebKit `RealtimeMediaSourceCenterCocoa.mm`, bugs.webkit.org/show_bug.cgi?id=239602 |
| Screen lock / background, Android | since Android 9 a background app cannot use the microphone (VERIFIED); Chrome's capture stops shortly after the screen turns off (2020 report, VERIFIED; current Chromium issues seen by title only, UNVERIFIED) | developer.android.com Android 9 changes, lists.w3.org public-webrtc-logs 2020-03 |
| Keep-alive tricks | silent audio loops and similar tricks are unreliable for capture; none is sanctioned. VERIFIED as reported in the bug threads | bugs.webkit.org/show_bug.cgi?id=261554 |
| Screen Wake Lock | Safari 16.4, but **Home Screen web apps only from iOS/iPadOS 18.4** (VERIFIED on the WebKit 18.4 notes); Chrome Android 84; released when the page is hidden, re-request on `visibilitychange`; a low battery can release it. VERIFIED | webkit.org/blog/16574, MDN Screen Wake Lock API |
| Capture mute events | Safari 18.4 lets a page observe and request capture mute/unmute (MediaSession capture mute API). VERIFIED | webkit.org/blog/16574 |
| AudioWorklet | Chrome 66, Safari 14.1 / iOS 14.5. VERIFIED. `AudioContext` sample rate is the device's (often 48 or 44.1 kHz), so resample (MediaPipe does it, at a cost, section 5) | caniuse, MDN AudioContext |
| Processing constraints | ask `{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }` and read `track.getSettings()` to see what applied: noise suppression is tuned for speech and may remove a cry. In Safari `echoCancellation: false` also turns AGC off (VERIFIED, WebKit 179411); Safari's support for `noiseSuppression`/`autoGainControl` as separate constraints is UNVERIFIED | MDN MediaTrackConstraints, bugs.webkit.org/show_bug.cgi?id=179411 |
| Playback while capturing (iOS) | an open microphone switches the iOS audio session to play-and-record; a 2026 WebKit bug reports playback dropping to a low-rate mono route while the mic is on (VERIFIED as filed) | bugs.webkit.org/show_bug.cgi?id=311451, MDN Audio Session API |
| Permission prompt | Chrome's "Allow this time" is desktop only (VERIFIED for Chrome 116); Permissions API `query({name: 'microphone'})` exists in Safari 16+ but its support for the microphone name is UNVERIFIED, wrap in try/catch | developer.chrome.com/blog/one-time-permissions, caniuse permissions-api |

Consequence for the PWA: **a web cry detector only runs while its page is visible and the screen is on**. That is a
"monitor mode" on a spare, plugged-in phone or tablet next to the baby, with the screen dimmed but on (Wake Lock), not
a background feature of the parent's own phone.

**The Capacitor shell** (what continuous listening with the screen off would need; not tested here):

- Android: a foreground service with `android:foregroundServiceType="microphone"`, permissions `RECORD_AUDIO`,
  `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MICROPHONE` (Android 14), a visible ongoing notification; it must be
  started while the app is in the foreground (a microphone service cannot be started from the background). VERIFIED
  (developer.android.com fgs service types, background start restrictions). Whether the WebView's `getUserMedia`
  survives inside such a service is UNVERIFIED: plan for native capture (AudioRecord) feeding the same YAMNet model
  natively (MediaPipe Tasks Android, the same `.tflite`) or posting PCM chunks to the WebView.
- iOS: `UIBackgroundModes` `audio`, `NSMicrophoneUsageDescription`, an `AVAudioSession` in `playAndRecord`; Apple DTS
  says background recording can continue if started in the foreground, and calls interrupt it (VERIFIED,
  developer.apple.com/forums/thread/774784). Whether WKWebView capture keeps running with the screen locked: reports
  conflict (forums 689182 says yes on iOS 17.5.1, 727009 and WebKit 241480 say no). Plan for native capture
  (AVAudioEngine + MediaPipe Tasks iOS or TFLite) with the web only showing state.
- No maintained Capacitor plugin combines PCM streaming, an Android microphone service and iOS background audio
  (cordova-plugin-audioinput MIT streams PCM but says nothing about background; capacitor-background-mode MIT covers
  Android only; Capawesome's recorder is commercial and records files). Expect a small custom plugin.
- Store rules: Apple 2.5.4 (background modes only for their purpose; continuous audio capture is a legitimate use but
  draws review attention), 2.5.14 (explicit consent and a visible or audible indication while recording); Google Play:
  the foreground-service declaration form (a description and a demo video of the user starting capture), the
  prominent disclosure before the microphone permission, and the monitoring policy (an app that monitors another
  person must say so; the parent-monitoring-child case is allowed when the app is exclusively for it, which Lotties is
  not, so the feature must be opt-in, visible and never hidden). Privacy labels: audio processed only on the device and
  never sent is **not "collected"** for Apple (VERIFIED, App privacy details) nor for Google's Data safety form
  (ephemeral on-device processing is exempt, VERIFIED); the detected event (a timestamp) is health-adjacent app data
  that the existing labels must cover.

## 7. Legal and consent (Brazil, LGPD; not legal advice)

- Processing a child's data needs to be in her best interest and, for consent, the specific and highlighted consent
  of at least one parent (Lei 13.709/2018 art. 14, read on the Câmara's copy of the original text; later amendments not
  compared). The ANPD's Enunciado CD/ANPD 1/2023 allows the other legal bases of art. 7 and 11 for children when the
  best interest prevails (read through a law firm summary: UNVERIFIED).
- Transient processing is still "tratamento" (art. 5 X includes "utilização" and "processamento"), even when the audio
  is never stored. Voice is not named as sensitive data; a cry log is health-adjacent. Safest reading: treat it as
  sensitive and ask for specific, highlighted consent (art. 11), per device, revocable at any time.
- The household exemption (art. 4 I) covers the parent's private use, not Lotties as the provider of the software; on a
  self-hosted install the operator is the family, on lotties.app it is the project.
- Other people in the room (a nanny, a domestic worker, visitors) are also picked up by the microphone, even if
  nothing is stored. The consent screen should tell the parent to inform them, and the indicator must be visible.
- ECA Digital (Lei 15.211/2025, in force since March 2026, sanctions from November 2026 per secondary sources:
  UNVERIFIED) concerns services directed at or likely accessed by minors; Lotties is a parents' app, but the owner
  should get a legal read before shipping.

## 8. Product design proposal (not implemented)

A proposal to decide on, not a settled design: layout, wording and defaults are the owner's call.

**Where it runs**: "Cry monitor" mode on a spare phone or tablet in the baby's room (or the parent's phone on the
bedside table), plugged in, screen on and dimmed (Wake Lock), page in the foreground. Never in the background of the
web app; background listening only after the native-shell work of section 6. Roles that log (Owner, Parent,
Caregiver); hidden for Viewers and the Doctor (docs/design/16).

**Consent screen** (once per device, before the browser prompt; en, pt-BR to be written with the i18n catalog):

> Cry monitor listens to the microphone on this device to notice when your baby cries for a while. The sound is
> analysed here, on this device, a second at a time, and immediately discarded: nothing is recorded, stored or sent.
> Only the event "crying started at 21:40" is saved to your baby's log and, if you choose, sent to the family as a
> notification. Keep the screen on and the device plugged in. Tell anyone else who may be in the room. This is not a
> baby monitor or a safety device: it can miss crying and it can be wrong. Never rely on it instead of being able to
> hear your baby.
> [Start listening] [Not now]

**While listening**: a full-screen calm page with a large "Listening" indicator, a live level dot (no waveform, no
audio), the time since start, and one large **Stop** button (one tap, no confirmation); the browser's own microphone
indicator stays visible. Stopping, leaving the page, locking the screen or a revoked permission all end listening and
say so. Sensitivity in the monitor's settings: Low / Standard / High, mapped to the three thresholds of section 4
(same N, M, smoothing). As built (CD1): Less / Balanced / More = 0.03 / 0.02 / 0.01, kept inside the safe band
(docs/design/35-cry-engine.md section 3).

**Event flow**: when the trigger fires, the device writes a `fussy` event through the normal local commands (client
GUID, Dexie + outbox) with `started_at` = the start of the first active window of the sustained run, running; it sets
`ended_at` after Q = 3 min of quiet. Two new hidden optional payload fields on the built-in `fussy` type (one seed
migration like `FussyOutcomes`): `auto_detected` (boolean) and `cry_confirmed` (boolean, unset until a parent answers).
The API sends a new push kind `cry_detected` through the existing Web Push sender (docs/design/09) to the other
members who turned it on: generic text only, "Crying detected at 21:40" / "Choro detectado às 21:40", no audio, no
score, no name unless "Show names" is on; dedupe key = the event id; not sent when the event reaches the server more
than 10 minutes late (stale). Event-driven sends need a small addition to the scheduler (a planner input "auto fussy
events created since the last tick"), not a new service.

**Feedback**: tapping the notification opens the event (notification actions never write data, docs/design/09
section 1); the event detail and the Now card of a running auto-detected spell offer "Yes, crying" and "Not crying".
The answer sets `cry_confirmed` true or false; "Not crying" also soft-deletes the event (deletes are soft, so the flag
stays and false alarms can be counted later from events alone, with no audio). This is the only way to measure the
real false-alarm rate.

**Failure modes**: permission denied or revoked (the track ends or mutes: stop and show "Microphone access was turned
off"), page hidden or screen locked (iOS and Android stop capture: stop and say so, offer to restart when visible;
never pretend to listen), Wake Lock refused (warn that the screen may lock), offline (the event waits in the outbox,
the push goes out when it syncs or is dropped as stale), another app takes the microphone (a call: muted track, same
as revoked), low battery (warn below 20 % if not charging), a white-noise machine or the device itself playing white
noise (the hardest bed in section 4: detection 97.9 % at 5 dB SNR, 91.7 % at 0 dB, slower), several monitors in one home (each logs its own event: the server should merge auto
events of one baby that overlap, or the monitor setting should say "one per baby").

**Limitations text** (settings and help): "Cry monitor is not a baby monitor or a safety device. It only listens while
this screen is open, on and unlocked. It can miss crying, especially from another room, behind a closed door or over
loud noise, and it can mistake other sounds for crying. Always keep a way to hear your baby yourself."

## 9. Limits of this evaluation

This is a synthetic evaluation and it is optimistic. Read every number above as "on these datasets and these
simulated rooms", not as the false-alarm rate a family will see.

- **Little cry audio, reused.** The test split has 111 Donate-a-cry clips (about 13 minutes) and 16 ESC-50 cry clips
  (80 s); 24 episodes of 1-10 minutes reuse them many times. The detection rate is a rate over episodes built from a
  few dozen babies, not over babies.
- **Donate-a-cry is 8 kHz** (telephone band, nothing above 4 kHz) and was uploaded from phones held close to the baby,
  so it is clean, loud crying. Real cries at 2-4 m, with fussing and whimpering between cries, are harder.
- **The negatives are not a home.** ESC-50 and LibriSpeech cover many sounds but not the hardest ones: TV and video
  audio (often with babies crying), siblings crying or screaming, baby laughter and cooing, a parent singing a
  lullaby, the family's own white-noise machine at full volume. Music is synthetic. A real home could have a false
  alarm rate several times higher than the household days here.
- **Acoustics are simulated**: one wall filter, a synthetic reverb, stationary beds. Real rooms, phone microphones,
  automatic gain and the browser's audio path (even with processing off) differ.
- **Days are compositions** of scored items, reused across days; the stress days repeat a few hundred unique negative
  stretches. Rates are estimates with wide uncertainty, and 0 false alarms in N days means "less than about 3/N per
  day" (95 %), not zero.
- **The head is trained on the same datasets** it is tested on (other folds and families) **and through the same
  simulator**: a quarter of its cry training windows went through the same wall filter as the closed-door test
  condition, so its 94.8 % behind a closed door is partly learned from our filter, not from real walls. Its edge over
  zero-shot YAMNet may shrink on real homes; the zero-shot score has no such risk. The head also needs a threshold of
  0.9 or more: its scores on plain noise beds are not near zero (on validation, below 0.6 it gives false alarms on
  household days, and below 0.2 events that never end).
- **No device was tested.** Phone numbers are extrapolations (section 5).

## 10. Real-world validation still needed

1. A home pilot with consenting volunteer families (5-10 homes, 2-4 weeks, Brazil): the monitor runs as in section 8
   and parents answer "Yes / Not crying" on each event and log missed cries by hand. No audio is collected; the outcome
   is the confirmed share (precision) and the parent-reported misses (recall), per device model. Written consent of
   the parents (LGPD art. 14), a plain-language information sheet, a way to stop at any time, and an ethics review if
   the results are to be published (Brazilian CEP/CONEP rules apply to research with people).
2. Device tests on real phones: an old Android (2-4 GB RAM, Android 10-12) and an iPhone with iOS 18.4+: model load
   time, CPU, battery per hour plugged and unplugged, temperature, the screen-on behaviour, Wake Lock, capture after a
   call, permission persistence in the installed PWA.
3. Acoustic checks no dataset here covers: TV and video audio with babies crying, older siblings crying and screaming,
   baby laughter and cooing, cats, the family's own white-noise machine at the levels they use, phone placement (on a
   shelf vs next to the cot).
4. If any audio is ever needed for a model update, it is a separate, explicitly consented collection with its own
   ethics review; this design never needs it.

## 11. Risks

- **Misses look like safety failures** even with the disclaimer; the copy, the "not a safety device" line and the
  visible listening state carry that risk. Do not market it as a monitor.
- **Background is the expectation**: parents expect it to work with the screen off; the PWA cannot. Monitor mode on a
  spare device is the honest scope until the native work exists.
- **Synthetic evaluation optimism** (section 9): real homes have TV, siblings, distance and reverberation we did not
  model; the real false-alarm rate is unknown until the pilot.
- **iOS PWA microphone bugs** (relaunch, audio route): may make iPhone monitor mode flaky; test early.
- **Model licence flag C1** and dataset licences (section 12) for anything that ships.
- **Battery and heat** on an old device running all night with the screen on.
- **Push timing**: the parent's notification depends on the monitor being online and the API scheduler tick (up to
  about a minute plus sync).

## 12. Licences and credits

| Item | Licence | Ships? | Credit needed if shipped |
|---|---|---|---|
| YAMNet weights (`yamnet.tflite`, MediaPipe hosted) | Apache 2.0: tensorflow/models `research/` and Google's Kaggle listing of all YAMNet variants (read through the Kaggle API, 2026-10-23); **flag C1 (minor)**: the MediaPipe page for this exact file states no licence; ask or keep the Kaggle reference in the credit | yes, if built | yes: "YAMNet (Google), Apache-2.0" as a curated credit (docs/design/25) plus the NOTICE text |
| `@mediapipe/tasks-audio` 1.1.1 (JS + WASM) | Apache-2.0 | yes, if built | yes, generated with the npm credits once it is a dependency |
| AudioSet ontology (class names) | CC BY-SA 4.0 (ontology), labels CC BY 4.0 | the class names live inside the model metadata | mention with the YAMNet credit |
| AST weights, Transformers.js, onnxruntime-web | BSD-3-Clause, Apache-2.0, MIT | no (not recommended) | - |
| ESC-50 | CC BY-NC 3.0 | **no** (evaluation only; non-commercial) | cite in this report only |
| Donate-a-cry corpus | ODbL 1.0 + DbCL 1.0 | no (evaluation only) | cite in this report; if ever used to train a shipped head, ODbL attribution and share-alike of the derived database apply: owner decision |
| Mini LibriSpeech | CC BY 4.0 | no | cite in this report |
| The `yamnet_head` weights (522 numbers) | trained by us on ESC-50 (NC) and Donate-a-cry (ODbL) clips | only if the head ships | **flag C2**: weights trained on CC BY-NC data are arguably a derived work; retrain on permissively licensed data or ship the zero-shot score (section 0) |

Credits TODO (docs/design/25-credits.md section 5): add the YAMNet model and MediaPipe Tasks Audio when the detector
is built; nothing from this spike ships today.

## 13. Build phase (if GO): tasks

Tiers as in docs/agents/PLAN.md (Light = Haiku, Medium = Sonnet, Careful / Heavy = Opus). UI decisions (monitor page
layout, copy) belong to the orchestrator and the owner, not to the workers.

| # | Task | Tier | Deps | Verify |
|---|---|---|---|---|
| CD0 | Owner decisions: scope (foreground monitor mode only), licence flags C1 (YAMNet weights) and C2 (head or zero-shot), consent text and legal read (LGPD art. 14, ECA Digital), push kind default off | Owner | this report | written answers |
| CD1 | Trigger in TypeScript (`code/web/src/cry/trigger.ts`), a port of `trigger.py`, with shared vectors (`cryTriggerVectors.json`, like the vaccine status vectors) written by a small new harness command from `trigger.py`, and the sensitivity table. **Done** (commit e3dc055; `python -m cry_detector.make_vectors`; sensitivity Less / Balanced / More = 0.03 / 0.02 / 0.01, all inside the safe band 0.005-0.03: docs/design/35-cry-engine.md section 3) | Careful | CD0 | Vitest vectors equal Python |
| CD2 | Capture and inference: `getUserMedia` with processing off (read back `getSettings()`), AudioWorklet ring buffer, a dedicated worker running `AudioClassifier` (self-hosted `yamnet.tflite` and WASM under `/models/`, loaded only when the monitor opens, runtime-cached for offline use, never in the main bundle), score per 0.975 s, no sample ever leaves the worker or is stored; behind a feature flag | Careful | CD1; orchestrator adds `@mediapipe/tasks-audio` 1.1.1 in the main clone | Vitest with a fake worker; a manual check on Chrome desktop with a recorded test file played through a virtual microphone. **Done** (commits c842306, 753c32c; docs/design/35-cry-engine.md): engine, worker, worklet, self-hosted files and runtime cache; not wired to a page yet (the "feature flag" is that no route uses it). The manual check ran with a synthetic oscillator stream, not a recorded cry through a virtual microphone: still to do with CD3 |
| CD3 | Monitor page: consent, listening state, one-tap stop, sensitivity, Wake Lock, visibility and permission handling, failure states, i18n en + pt-BR (`locales/<lang>/cryMonitor.json`), axe, dev preview `/dev/cry-monitor?state=` | Medium | CD2 + owner-approved copy | Vitest, axe light/dark/night, screenshots 320-430 px. **Done** (2026-10-24, docs/design/35-cry-engine.md section 8): Hub > App entry, `/hub/cry-monitor`, per-device consent, night listening view, sensitivity while listening (`CryEngine.setSensitivity`), Wake Lock, failure cards, privacy policy v3. The copy is the orchestrator's draft: the owner's read and the legal read are still open (CD0) |
| CD4 | **Done** (2026-10-24, commit d7ec253 + web labels): API seed migration `CryDetector`: hidden optional `auto_detected` and `cry_confirmed` booleans on the built-in `fussy` type, export/import round trip | Careful | CD0 | model + endpoint tests, migration tests |
| CD5 | Web event flow: start the running `fussy` spell on trigger (Now commands, outbox), close after quiet, merge overlapping auto spells of one baby, "Yes, crying" / "Not crying" in the event detail (sets `cry_confirmed`; "Not crying" soft-deletes) | Medium | CD3, CD4 | Vitest incl. offline outbox. **Done** (2026-10-24, docs/design/35 section 8) with one change decided by the orchestrator: "Not crying" keeps the entry (deletable as usual) and the readers (fussy pattern card, cry outcomes, formula comparison, heads-up clean-up) leave it out; a running auto spell is kept instead of a second one, and none is created over a spell started by hand |
| CD6 | **Done** (2026-10-24, commits d7ec253 API and 50d1265 web; docs/design/09 section 2.12): Push kind `cry_detected` (docs/design/09): planner input "auto fussy events since the last tick", stale cutoff 10 min, dedupe by event id, off by default, generic text, service-worker catalog en + pt-BR | Careful | CD4 | planner and dispatch tests, `NotificationCodes` appended |
| CD7 | Credits: curated YAMNet entry and NOTICE, regenerate the generated credits after the dependency (orchestrator) | Light | CD2 | `generate-credits.mjs --check`, credits test. **Done** (2026-10-24, with CD3): curated `yamnet` (YAMNet via MediaPipe Tasks Audio, Apache-2.0) and `audioset` (AudioSet ontology class names, CC BY-SA 4.0), CREDITS.md regenerated; the npm package's notice is in the generated list |
| CD8 | Device checklist on HTTPS staging: an old Android and an iPhone on iOS 18.4+ (load, CPU, battery per hour, heat, Wake Lock, relaunch, a phone call, permission persistence), fixes | Medium | CD5 | checklist in the PR |
| CD9 | Pilot with consenting families (section 10): confirmed share and parent-reported misses per device; adjust the sensitivity table | Owner + Medium | CD8 | pilot summary (aggregates only) |
| CD10 | Native shell, separate go/no-go: Android microphone foreground service with native capture and MediaPipe Tasks Android; iOS background audio spike with native capture | Heavy | CD9 | device tests, store declarations |

Notes on CD4 and CD6 as built (migration `CryDetector` carries both: the fussy seed and the `cry_detected` preference
column with the widened candidate index):

- The planner reads the monitor's spells as "fussy spells, not deleted, `auto_detected` true, not marked Not crying,
  started in the last 10 minutes or still running then" rather than "since the last tick": the dedupe key
  `cry:{eventId}` makes every tick idempotent, so no tick bookkeeping is needed. A spell that starts while an earlier
  monitor spell of the baby is still going is the same episode and sends nothing (two monitors, merged spells).
- Recipients follow `dose_due` and the diaper heads-ups: Owners, Parents and Caregivers who turned the switch on, on
  every opted-in device; never a Viewer or the Doctor. Delivered inside quiet hours (an owner decision to confirm: the
  monitor mostly runs at night, when quiet hours are on by default).
- The device that runs the monitor is not known to the server and the service worker always shows a push, so that
  device gets the alert too when its member opted in on it; the monitor page closes it by tag `cry:{babyId}`
  (docs/design/09 section 2.12; every 10 s while listening and on each detected cry, CD3).

Notes on CD3 and CD5 as built (docs/design/35-cry-engine.md section 8):

- Section 8's proposal had "Not crying" soft-delete the spell; as built it keeps the entry and marks it, and every
  local reader of crying (patterns, outcomes, statistics) ignores it, so the false-alarm rate can still be counted
  from events alone. The server's fussy pattern detector (predictions) does not ignore it yet: a small API change.
- Sensitivity changes while listening move the threshold without restarting capture (no split spell).
- Two monitors in one home: the second keeps the first one's running spell and ends it at its own cry end.

## 14. Reproduce

See `ml/cry_detector/README.md`: `python -I -m cry_detector.fetch`, `python -I -m cry_detector.evaluate --out out/full`
(results.json and results.md, aggregates only), `python -m pytest`, and the browser bench `node browser/bench.mjs`.
Seeds are fixed (20261023); the full run took about 65 minutes on a Ryzen 9 5900X (scoring the libraries about
40 minutes, cached afterwards; sweeps, test days and the AST clip-level pass about 25 minutes).
