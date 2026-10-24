# Cry engine (CD1 + CD2)

Status: built (CD1, CD2) and wired to the monitor page (CD3) and the fussy event flow (CD5), section 8. The engine
behind the foreground "cry monitor" of [31-cry-detector-spike.md](31-cry-detector-spike.md) (tasks of its section 13).
The engine itself shows no text, writes no event and calls no API; the page (`code/web/src/cryMonitor/`) does.

Decisions taken before the build (CD0): foreground monitor mode only (screen on, spare plugged-in device); YAMNet
through MediaPipe Tasks Audio, **zero-shot**, reading the model's own "Baby cry, infant cry" score (no trained head:
licence flag C2 avoided); the spike's rule as the default.

## 1. Architecture

```
microphone ─ getUserMedia (processing off) ─ AudioContext (device rate)
   └─ AudioWorklet (captureWorklet.ts): mono downmix, windowed-sinc resample to 16 kHz,
      15600-sample frames (0.975 s) in a pool of buffers ── transferred ──┐
                                                                         main thread (capture.ts → engine.ts)
   classifier worker (classifier.worker.ts): MediaPipe AudioClassifier ◄─┘ transferred, and back
      score of "Baby cry, infant cry" per frame ──► CryTrigger (trigger.ts) ──► cry_started / cry_ended
```

- No audio leaves capture and the worker: each frame buffer goes to the worker and comes back for reuse; only a
  score and a time reach the engine. Nothing is stored or sent.
- The classifier runs in a dedicated module worker, its own chunk; `@mediapipe/tasks-audio` is imported only there.
  `createCryEngine()` imports capture and classifier with `import()` when it starts. `bundleBoundary.test.ts` walks
  the static import graph from `src/main.tsx` and fails if MediaPipe or the worker is reachable from it.
- Frame times: the first frame is anchored to the wall clock when it arrives, every next one is 975 ms later (sample
  exact); the trigger sees a regular grid. Frames dropped by capture (all buffers out because the classifier is far
  behind) keep their sequence number, so the trigger counts them as quiet windows.
- YAMNet's TFLite output is quantised in steps of 1/256 (about 0.0039); the thresholds below are the spike's numbers,
  evaluated on the same file (parity 5e-7), so nothing changes, but a threshold only matters to the nearest step.

## 2. Files (`code/web/src/cry/`)

| File | Role |
|---|---|
| `index.ts` | Public API: `createCryEngine()`, `CryEngine`, types, sensitivity, trigger |
| `engine.ts` | `CryEngine` facade: `start(options) / stop() / on(event) / setSensitivity(level)` (moves the threshold while listening, without restarting capture); state `idle \| loading \| listening \| error` with a typed `error`; `level` (smoothed score for a meter), `crying`, `lastFrameAt`, `capture` (processing left on), `model`, `stats` (frames, missed frames, load and inference ms); events `state`, `score`, `cry_started`, `cry_ended`, `stalled` (no frame for > 5 s, once), `resumed`; injectable `AudioSource`, `Classifier` and `Scheduler` |
| `trigger.ts` | `CryTrigger`: streaming port of `ml/cry_detector/cry_detector/trigger.py`; `push({t, score})`, `tick(now)` (closes a cry when frames stopped), `finish()` (stream end), `setThreshold(t)` (from the next window on: counted windows keep their flags, a running cry stays); no timers |
| `cryTriggerVectors.json` | Shared vectors written by `python -m cry_detector.make_vectors` (generated; in `.prettierignore`) |
| `sensitivity.ts` | Levels Less / Balanced / More → thresholds (section 3) |
| `capture.ts` | `MicrophoneSource` (`AudioSource`): constraints, `getSettings()` read-back, error codes, worklet wiring, frame timing |
| `captureWorklet.ts`, `captureProtocol.ts`, `audioFrames.ts` | Audio-thread processor (loaded with `?worker&url`), its messages, and the pure downmix / `StreamResampler` / `FrameAssembler` |
| `classifier.ts` | `WorkerClassifier` (`Classifier`): starts the worker, request ids, transfers |
| `classifier.worker.ts`, `classifierProtocol.ts`, `classifierCore.ts` | The worker shell (the only MediaPipe import), its messages, and the testable logic: model checks, label resolution by name, scoring |
| `modelAssets.ts` | Paths, pinned model URL / SHA-256 / size, MediaPipe version, runtime cache name (shared with the service worker and the build plugin) |
| `errors.ts` | `CryEngineError` and the codes |

Build and serving: `code/web/cry-assets.ts` (Vite plugin), `code/web/scripts/fetch-cry-model.mjs`,
`code/web/src/pwa/sw/cryAssets.ts` (runtime cache), `code/web/nginx.conf`, `code/web/Dockerfile`.

Error codes (`CryEngineErrorCode`): `denied`, `unavailable`, `lost` (track ended or muted while listening),
`insecure_context`, `model_missing`, `model_invalid` (not the pinned file), `class_missing` (no "Baby cry, infant cry"
in the label map), `unsupported` (no worker, AudioWorklet or WebAssembly SIMD), `classifier_failed`. The model is
loaded before the microphone is opened, so a missing model never triggers a permission prompt.

## 3. Rule and sensitivity

Default (the spike's standard rule, section 0 of doc 31): causal mean of 3 windows of the score; a window is active at
>= threshold; a cry starts when >= 20 s of the last 60 s are active, with `cry_started.at` = the start of the first
active window of that run (0-6 s from the true start in the spike) and `detectedAt` = the decision time; it ends after
3 min with no active window, with `cry_ended.at` = the end of the last active window. Stopping the monitor or losing
capture ends a running cry with `reason: 'stream_end'` at the end of the last frame.

Sensitivity moves the threshold only (smoothing, 20 s of 60 s and 3 min stay), and every level is inside the spike's
safe band 0.005-0.03 (false alarms appear at 0.005 on the test days; in-room detection falls below 95 % above 0.03).
The spike's own "high" (0.002) and "low" (0.05) are outside the band and are not offered.

| Level | Threshold | Evidence (doc 31 section 4.2, YAMNet zero-shot) |
|---|---|---|
| More | 0.01 | test days: 0 household and 0.04 stress-day false alarms a day; validation in-room 100 % |
| **Balanced** (default) | **0.02** | test: in-room 99.2 %, 0 false alarms in 216 days, median latency 29 s |
| Less | 0.03 | validation: in-room 96.2 %, 0 false alarms |

These are synthetic numbers (doc 31 section 9); the pilot (CD9) may move them.

## 4. Model files, build and caching

- **WASM**: the ES-module SIMD build of `@mediapipe/tasks-audio` 1.1.1 (`audio_wasm_module_internal.js` + `.wasm`,
  7 MB) is copied by `cry-assets.ts` from the installed package to `dist/models/cry/wasm/` at build time and served
  from `node_modules` by the dev server. Never a CDN.
- **Model**: `yamnet.tflite` (4,126,810 bytes, SHA-256 `4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf`,
  the spike's pinned file from MediaPipe's model storage) is **not committed**. `node scripts/fetch-cry-model.mjs`
  (in `code/web`) downloads it into `public/models/cry/` (gitignored), checks size and checksum, and does nothing when
  the file is already right; `--check` only verifies. Developers run it once to try the monitor locally.
- **Image**: the web Dockerfile runs the script in its own layer before copying the sources (a failure stops the
  image build) and builds with `CRY_MODEL_REQUIRED=1`, which makes the Vite plugin fail when the model is missing or
  different. `.dockerignore` keeps a local copy out of the context. The deploy's image tag is unchanged in kind: the
  script and the plugin are sources; the model is derived from the pinned script.
- **Without the model** (`npm run build` and `npm test` on a developer machine, offline): the build only warns, and
  monitor mode fails at start with `model_missing`. The worker checks the response itself (a 404, the SPA's
  `index.html`, a non-TFLite file or another checksum are refused) and nginx answers `/models/` with 404 instead of the
  app shell.
- **Native build** (`--mode native`): neither file is shipped; monitor mode in the shell is a separate decision
  (doc 31 CD10) that also needs the microphone permissions and `'wasm-unsafe-eval'` in `native-csp.ts`.
- **Service worker**: the files are excluded from the precache (`globIgnores: models/**`) and cached at run time,
  cache-first, on the first monitor start (`src/pwa/sw/cryAssets.ts`): same-origin GETs under `/models/cry/`, only
  complete 200 responses that are not HTML. The cache name carries the MediaPipe version and the model checksum
  (`lotties-cry-assets-mp1.1.1-4d8b4a53`); other cry caches are deleted on activate. A test fails when `package.json`
  pins another MediaPipe version until `MEDIAPIPE_AUDIO_VERSION` is updated.

## 5. CSP and permissions (code/web/nginx.conf)

- `script-src 'self' 'wasm-unsafe-eval'`: needed to compile the WebAssembly in the worker (checked in Chromium: with
  `script-src 'self'` alone the load fails with a CSP CompileError). It allows WebAssembly compilation only; JS
  `eval()` and inline scripts stay blocked. No `worker-src` is added: the worker, its WASM loader module and the
  worklet are same-origin and fall under `'self'`; no blob or data URL is used. `connect-src 'self'` already covers
  the model and WASM fetches.
- `Permissions-Policy: microphone=(self)` (was `microphone=()`, which blocks `getUserMedia` outright).
- `gzip_types` adds `application/wasm`; `location /models/ { try_files $uri =404; }`.
- The privacy policy (version 3, 2026-10-24) and docs/design/33-privacy-audit.md section 12 describe the monitor:
  the microphone only when someone starts it, the sound analysed on the device and never recorded, stored or sent,
  the model from our own server, the Permissions-Policy above, the auto spells and the encrypted alert.

## 6. Performance

Not measured again here: the spike's numbers stand (doc 31 section 5: 0.2 s load, 4.5-8.7 ms per 0.975 s window on a
desktop core, about 1 % of one core, +69 MB). This build feeds 16 kHz frames (the spike's cheaper path) after its own
resampler in the worklet. A functional run in Chromium (dev server and the production build under the nginx CSP, a
synthetic oscillator stream instead of a microphone) loaded the model, resolved the class to index 20 by name and
classified frames every 0.975 s; that run is a smoke check, not a benchmark.

## 7. Tests and tools

- `trigger.test.ts`: every vector of `cryTriggerVectors.json` gives the same events as `trigger.py` (exact
  timestamps: the smoothing uses the same running cumulative sum as numpy), plus tick, gaps and stream end.
- `engine.test.ts`: fakes for source, classifier and scheduler: lifecycle, `denied`, `model_missing` before the
  microphone, stop while loading, `lost`, `stalled`/`resumed`, buffers returned, and golden runs of recorded score
  sequences through the facade.
- `capture.test.ts` (mocked `getUserMedia` and Web Audio: constraints with processing off, read-back, error codes,
  track loss, frame timing, transfers), `audioFrames.test.ts` (resampler level, pitch, alias rejection > 40 dB,
  chunk invariance; frame pool without allocation), `classifierCore.test.ts` (label by name, `class_missing`, model
  checks), `classifier.test.ts` (worker protocol), `modelAssets.test.ts` (pins agree across app, script, spike;
  sensitivity band), `cryAssetsPlugin.test.ts`, `bundleBoundary.test.ts`, `src/pwa/sw/cryAssets.test.ts`.
- Vectors: `cd ml/cry_detector; .venv/Scripts/python.exe -m cry_detector.make_vectors` (writes the JSON; `--check`
  verifies, and `tests/test_make_vectors.py` fails when the committed file is stale). Setup in ml/cry_detector/README.md.
- Runtime bench of the model in headless Chromium: `ml/cry_detector/browser/bench.mjs` (README there).

## 8. The monitor page and the event flow (CD3, CD5; 2026-10-24)

Code: `code/web/src/cryMonitor/`. Design decided by the orchestrator (brief of 2026-10-24); copy in
`locales/<lang>/cryMonitor.json`.

**Entry and route.** Hub > App > "Cry monitor (beta)" / "Monitor de choro (beta)" (microphone icon), route
`/hub/cry-monitor`, its own lazy chunk (`CryMonitorPage.tsx`). Shown to Owners, Parents and Caregivers of the selected
baby (`canLog`), never to a Viewer or the Doctor, never in the native shell (web only for now, doc 31 CD10), and only
when the browser has `getUserMedia`, AudioWorklet, WebAssembly and workers (`support.ts`, detected once per load). By
URL: a Viewer and the native app go back to the Hub; the Doctor's patients are not in the family selection, so she
sees "create a baby first"; an unsupported browser sees "Not supported on this device" (no action). Nothing of
`src/cry` is in the main bundle or in the page chunk: `useCryMonitor` imports `../cry` with `import()` when "Start
monitoring" is pressed (`bundleBoundary.test.ts` walks both graphs).

**States** (`monitorState.ts`, a pure reducer): `intro` (what it does, how to use it, privacy, "Not a baby monitor"
limits, Start or Continue) -> `consent` the first time on the device (two checkboxes, "I understand and agree" and "I
am allowed to monitor this baby", then Agree; stored in localStorage as `{version, at}` under
`lotties.cry-monitor.consent`, `CRY_MONITOR_CONSENT_VERSION` = 1, cleared at sign-out with the account's device state
and asked again when the version changes; "Withdraw consent on this device" on the intro) -> `loading` (model, then the
microphone; Cancel) -> `listening` -> `intro` on Stop. Failures, each a card with one action: `denied` (short steps for
Chromium, iOS Safari, macOS Safari or Firefox, picked with the install guide's platform detection; Try again),
`unavailable` (Try again), `lost` (a call or another app took the microphone: "Microphone interrupted", Restart),
`stalled` (no audio frame for 5 s: the screen went off or the page was hidden; the monitor stops and says "Listening
stopped at 21:40 ... Nothing after that was heard", Restart; it never claims it kept listening), `model` (model missing
or invalid, classifier failed, or the engine chunk could not load: "Not available right now"), `unsupported`.

**Listening screen** (`ListeningView.tsx`): a full-screen dialog with `data-night` on its root, so it always uses the
night (Lamplight) tokens, near-black for OLED screens and never white, whatever the app scheme. A small pulsing dot
(opacity only, 2.4 s; off with reduced motion) and "Listening", the baby's name, since when, "Crying heard since 21:40"
while a cry runs, a 4 px level meter (the smoothed score, full at twice the threshold, never a number; static under
the night scheme's no-transition rule), quiet notes ("The screen stays on while listening", or the platform's "may turn
the screen off" warning when the Wake Lock is missing or refused, the iOS one naming 18.4+ for the installed app; "the
browser kept its voice processing on" when capture reports noise suppression, echo cancellation or AGC on; "Offline:
detected crying is saved here and syncs later"), the sensitivity control (Less / Balanced / More with the selected
level's one-line explanation; persisted per device in `lotties.cry-monitor.sensitivity`, kept at sign-out like the
theme; a change applies at once through `CryEngine.setSensitivity`), today's recent detections and a 72 px Stop button
that stays in view (sticky).

**Screen Wake Lock** (`screenWakeLock.ts`): requested when Start is pressed, requested again on every
`visibilitychange` to visible when the browser released it, released on Stop, on a failure and when the page is left.

**Leaving the page** (unmount, route change, `pagehide`): stops the engine (which ends a running cry at the end of its
last frame), releases the wake lock and drops the engine.

**Auto spells** (`autoSpells.ts`, the normal local commands: client GUID, Dexie, outbox; works offline, the server
records the signed-in member as author):

| Engine event | What the monitor does |
|---|---|
| `cry_started{at}` | Starts a running `fussy` spell of the baby at `at` (never later than the device clock) with only `auto_detected: true`. If a monitor spell of the baby already runs (another monitor, a spell kept from before), it keeps that one: one episode, one spell. If a spell started by hand runs, it creates nothing and will end nothing: the parent is already tracking. Also closes this device's `cry:{babyId}` alert. |
| `cry_ended{at}` | Ends the spell it started or kept at `at` (the end of the last crying window, not when the end became known), never before the spell's start or past the device clock. A spell somebody stopped or deleted meanwhile stays as it is. |
| Stop, stall, capture lost, page left | The engine emits `cry_ended` (reason `stream_end`) at the end of the last frame first, so the spell closes there. |

Writes run one after another (an end never overtakes its start). Overlapping or adjacent cries closer than the quiet
period are already one cry for the engine, and spells shorter than the rule never exist. Nothing sets
`suggested_cause` or `what_helped`.

**"Yes, crying" / "Not crying"** (`events/CryAnswerRow.tsx`): in the fussy spell's sheet for a monitor spell ("Detected
by the cry monitor. Was she crying?"; saved at once with `setCryConfirmed`, kept by a later Save of the sheet, editable
later), read-only in the Caregiver's sheet of someone else's spell, and in the page's "Recent detections" (today's last
five monitor spells, with time and length) for whoever may change the entry. "Not crying" keeps the entry (it can be
deleted as usual); `events/cryDetection.ts` `countsAsCrying` leaves it out of the fussy pattern card's "handled" check,
the cry outcome history ("What helped before"), the formula comparison's fussy counts and the fussy heads-up clean-up.
The server leaves it out too (`CryDetection.IsConfirmedNotCrying`): the fussy pattern in predictions and the
`fussy_pattern` push, including whether a spell already handled today's window (docs/design/31 section 13 notes).

**Alerts on the monitor device** (`monitorNotifications.ts`): the service worker always shows a push and does not
message the page about it, so while listening the page closes this device's `cry:{babyId}` notifications every 10 s
and on each detected cry (`PushDevice.shownNotifications`, by tag). Other devices keep theirs. The page links to
Settings > Notifications ("Get a notification on your other devices when crying is detected") instead of repeating
the switch.

**Tests**: `monitorState.test.ts` (every transition), `monitorDevice.test.ts` (consent versioning and sign-out, the
sensitivity, feature detection, wake lock request / re-request / unsupported / denied, closing alerts by tag, the
platform wording), `autoSpells.test.ts` (start at `at`, kept, none over a manual spell, end at `at`, clamps, answers,
outbox), `CryMonitorPage.test.tsx` (the flow with `FakeCryEngine`, failures, roles, native, recent detections, axe on
every state in light, dark and night, en and pt-BR), `EventSheet.cryMonitor.test.tsx`, and the readers' tests. Developer
preview `/dev/cry-monitor?state=intro|consent|loading|listening|denied|lost|stalled|unsupported&scheme=...`; screenshots
and axe (contrast included) with `npx playwright test -c design-review/cry-monitor-preview.config.ts` in `tests/e2e`.

**Not verified without a real microphone and devices** (doc 31 CD8): the browser permission prompts and their
"denied" paths on each browser, the iOS installed-app microphone after a relaunch, Wake Lock on iOS 18.4+ and on
Android, what happens to capture on a call or with the screen locked on each platform (the stall and `lost` paths are
exercised with the scripted engine only), the processing read-back on real hardware, battery and heat.
