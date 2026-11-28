# 49a. Voice lab spike (Phase 0 of the hands-free mode, 2026-11-28)

> **This branch (`feat/voice-lab`) is a spike and is NOT to be merged into `main`.** It exists so a Mobile release
> run on this ref puts the voice lab on the owner's own phones (TestFlight internal, Play internal). It turns the
> lab on in `code/web/.env.native` (`VITE_VOICE_LAB=true`), asks Android for `RECORD_AUDIO`, declares the iOS
> microphone and speech recognition purpose strings and registers a native plugin, none of which the shipped
> privacy policy, the privacy audit (design 33) or the store forms describe. What may later go to `main` (the
> parser, the plugin) goes through Phase 1 of design 49 with its policy, audit and store changes, not by merging
> this branch.

Design: docs/design/49-hands-free.md (on branch `docs/hands-free-design`), section 7 is the spec. Status: built and
unit-tested on the web side; the native plugin is written against the official API references and the Capacitor
8.5.3 sources but **never compiled here** (no Android SDK, no Xcode): run the compile checks below before the release.

## 1. What is built

| Part | Where | What it does |
| --- | --- | --- |
| Switch | `code/web/src/voiceLab/featureFlag.ts` | `VITE_VOICE_LAB`, on only for `true` (the `VITE_CRY_MONITOR` pattern). The route and the Settings line import their chunks only behind the inline comparison `import.meta.env.VITE_VOICE_LAB === 'true'`, so a build without it has no lab chunk |
| Lab page | `code/web/src/voiceLab/` (`VoiceLabPage.tsx` at `/lab/voice`, inside the app shell) | Language, engine, condition; what the phone reports; one phrase at a time with a large Speak button, the listening state and Cancel; after a result the n-best texts, the parsed command, pass or fail, latency, Retry and Next; the summary table; Export results; free try; key logger |
| Settings line | `voiceLab/VoiceLabLink.tsx` | One line in Settings > Voice assistants, only in the lab build |
| Parser v0 | `code/web/src/voice/` (`commandParser.ts`, `tokens.ts`, `numberWords.ts`, `lexicon.ts`, `speechHints.ts`) | Kept for Phase 1. Shared vectors `voice/handsFreeCommandVectors.json` |
| Speech adapter | `code/web/src/platform/speech.ts`, `speechTypes.ts`, `webSpeech.ts` | `speechPlatform()`: the `LottiesSpeech` plugin inside the app (lazy `@capacitor/core`), the `web` engine (`webkitSpeechRecognition`) where it exists |
| Android plugin | `code/mobile/android/app/src/main/java/app/lotties/app/speech/` (`LottiesSpeechPlugin.kt`, `SpeechCodes.kt` + JVM test) | Registered in `MainActivity.java`; `RECORD_AUDIO` and the `android.speech.RecognitionService` `<queries>` entry in `AndroidManifest.xml` |
| iOS plugin | `code/mobile/ios/App/App/LottiesSpeechPlugin.swift` | Registered in `LottiesBridgeViewController.swift`, added to `App.xcodeproj`; `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` (one string in English and Portuguese each) in `Info.plist` |
| Preview | `code/web/src/dev/VoiceLabPreview.tsx` (`/dev/voice-lab`, dev server with the flag only), `voiceLab/fakeSpeech.ts` | Scripted engines for tests and screenshots: `tests/e2e/design-review/voice-lab-preview.config.ts` |

Not built (section 7.2 allows it): iOS 26 `SpeechTranscriber` (deferred: it needs `AssetInventory`, an audio format
converter and an async analyzer loop that cannot be tried without Xcode; the CI's Xcode 26.5 could compile it, but a
wrong guess costs a macOS run and risks the whole build). Spoken answers (TTS), wake word, NFC.

## 2. The lab

- **Engines** are explicit choices, never swapped: **On device** (default), **Server**, **Web**. On device that
  cannot do the language says so (`on_device_unavailable`, `language_unavailable`) and nothing is recorded; the
  plugin never retries on a server. Choosing Server or Web shows a warning that the voice reading the phrases goes
  to Google or Apple (Web: may go, destination unknown) and Speak stays disabled until the one-time checkbox (per
  engine, per visit) is ticked.
- **Phrases per run** (section 7.3): pt-BR C1 and C3 all 24, C2 `1, 7, 10, 12, 14, 16, 18, 21`, C4 `1, 7, 12, 16, 21`
  (61 on-device utterances); English has no subsets: its 11 phrases (the 10 plus "four ounce bottle" parsed in the US
  system) in every condition, measured once in C1. Each run (engine, condition, language) keeps its own position.
- **Attempts**: the first attempt of a phrase in a run is what the measures count; Retry replaces the attempt shown
  and increments a retry count shown on screen, in the table and in the export, so a retried failure stays visible.
  Recognition results count, and so do `no_match`, `speech_timeout`, `network`, `audio`, `timeout` and
  `recognizer_error` (no text, a failed attempt). Setup problems do not create an attempt: `denied`,
  `language_unavailable`, `on_device_unavailable`, `not_available`, `busy`, `cancelled`, `interrupted`.
- **Pass**: a command phrase passes when the parsed command and every slot equal the expected one; phrases 22 to 24
  pass when nothing would be logged. **Wrong action**: a logging command that is not the expected one (the two
  questions do not log). **Wrong amount**: a wrong action that logs a bottle with an amount that was not said.
- **Latency**: the engine's end of speech to the parsed result (parser time added). Android: `onEndOfSpeech` (after
  the system endpointer's silence) to `onResults`. iOS: buffer requests have no end-of-speech event, so the plugin
  ends the audio after 1.2 s without a new partial result; that moment is the end of speech. Web: `speechend` to
  `result`. The 1.2 s (iOS) and the endpointer's wait (Android) are not in the number.
- **Summary** (section 7.4): per engine, language and condition, plus "All" per engine and language once there are
  two conditions: attempts, accuracy (target 90 % C1, 80 % C2 and C3), wrong actions and rate (target 2 % at most),
  wrong amounts (none in C1), 22-24 logged (none), latency median (1.5 s) and 90th percentile (3 s, nearest rank),
  attempts with text (C4: all), retries. Values below target are marked.
- **Export results**: `lotties-voice-lab-YYYYMMDD-HHMM.json` through `platform/saveFile.ts` (share sheet in the
  app): format `lotties-voice-lab` v1, app version and commit, what the phone reported per language, every phrase
  record (phrase, expected, engine, condition, retries, first and latest attempt: n-best texts, confidences, parsed
  result, pass, wrong action, latency, error) and the summary. **Free tries are never exported** (anything could have
  been said); they stay on screen (last 5) until the page closes.
- **Key logger**: while its panel is open, every `keydown` (key, code, time), the last 20.
- **Isolation**: the lab writes no event and nothing to Dexie, the outbox or the server, reads no baby data, calls
  no API, and logs nothing (no `console`, no `appLog`; the in-app Logs feature records only explicit `appLog`
  calls, of which the lab makes none). The native plugins log nothing either. Tested in `VoiceLabPage.test.tsx`
  (rendered with no data layer at all; console and app log spied).

## 3. Parser v0 (kept for Phase 1)

`parseCommand(text, {locale, units, running?})` and `parseAlternatives(nBest, ...)`. Words are grouped by role
(`lexicon.ts`), not by phrase, so phrasings never listed still parse; the tests also build every number from 1 to 999
in Portuguese and English words, and check that every logging vector, negated, moved to another day, made an
intention or a question, never logs.

- Logs nothing on: a negation (`não`, `nem`, `sem`, `not`, `n't`, `no`); a question (question mark, question words,
  English auxiliary first) other than the two v1 questions, which are about today only; another time or a plan or a
  habit or a hedge (`ontem`, `vai`, `quase`, `ainda`, `acho`, `will`, `going to`, `still`, `or`...); a clock time, a
  duration or a count (`há 10 minutos`, `3 vezes`, `15h30`); a comment about a sleep (`dormiu bem`, `fell asleep
  late`); a past feed (`mamou no peito esquerdo`); two commands, two sides, two amounts, two contents; a number that
  cannot be read safely (`120 150`, `one twenty`, `1.2.3`); a number in a non-bottle command.
- Bottle: an amount in 1-500 ml (`AssistantLimits`); a bare number is ml in the metric system and fl oz in the US
  one, a said unit wins (`ml`, `mililitros`, `onças`, `oz`, `litros`); `1.000` is a thousand; out of range is
  `out_of_range`, no amount is `needs_amount`.
- n-best: the first alternative that is a command wins, unless a better-ranked one already said why nothing may be
  logged ("não dormiu" above "dormiu" logs nothing); only alternatives with no command words at all are skipped.
- Known limits: the subject is not checked ("o cachorro dormiu" is a sleep); on Android, which adds no question
  marks, a yes/no question without a question word ("ela acordou") is a statement; a bare "parou" / "stop" needs the
  running timers (`running`), which the lab does not pass (no baby data).

## 4. Native plugin `LottiesSpeech` v0

Methods: `capabilities({locale})`, `listenOnce({locale, onDevice, hints, maxResults, timeoutMs})`, `cancel()`,
`downloadModel({locale})`, event `speechState` (`ready`, `speech`, `processing`). Errors are rejected with the codes of
`platform/speechTypes.ts`.

- Android: main thread only; permission alias `microphone` (`RECORD_AUDIO`) asked at the first Speak; on-device needs
  API 31 (`isOnDeviceRecognitionAvailable`, `createOnDeviceSpeechRecognizer`), and on API 33+ the language is checked
  first with `checkRecognitionSupport` (installed, pending, downloadable) and must be installed; biasing
  `EXTRA_BIASING_STRINGS` on API 33+; `downloadModel` uses `triggerModelDownload` (API 34 with progress, API 33 fire
  and forget, below: `unsupported`). Busy on double start; a watchdog timeout; the recogniser destroyed on result,
  error, Cancel, timeout and `handleOnPause` / `handleOnDestroy`.
- iOS: speech recognition then microphone authorisation at the first Speak; on-device sets
  `requiresOnDeviceRecognition` and refuses when `supportsOnDeviceRecognition` is false; `contextualStrings` (100 at
  most), `addsPunctuation` (iOS 16, so a question mark can refuse a question); audio session `.record` /
  `.measurement`, released with the engine and the tap on every way out, including the app going to the background
  and an audio interruption. iOS cannot start a language download: Settings > General > Keyboard > Dictation
  languages (and the Siri language) decide what is on the device.
- The web side also cancels on `visibilitychange` (hidden) and `pagehide`, and ignores a second tap while listening.

## 5. Checking it

| What | How | Result (2026-11-28) |
| --- | --- | --- |
| Web unit tests | `npm --prefix code/web test -- run` | 785 new tests in 8 files pass (parser vectors and properties 704). Whole suite: 5857 pass; one Settings test timed out under the full parallel load and passes alone; one suite cannot load locally (`@mui/icons-material` missing from this machine's node_modules, known) |
| Lint, format, types | `npm --prefix code/web run lint`, `npx prettier --check`, `tsc -p tsconfig.json --noEmit` | clean except the known local `@mui/icons-material` gap |
| No lab in a build without the flag | `npx vite build --outDir <tmp>` in code/web, then search the output for `LottiesSpeech`, `webkitSpeechRecognition`, `/lab/voice`, `lotties-voice-lab` | none found; `VoiceLabPage-*.js` and `VoiceLabLink-*.js` exist only in `vite build --mode native` (flag on). The catalogs still carry the `voiceLab.*` strings (the i18n chunks hold every feature's text, CLAUDE.md rule) |
| Screenshots | `cd tests/e2e && npx playwright test -c design-review/voice-lab-preview.config.ts` (port 5418) | `docs/design/screenshots/voice-lab-*.png` (gitignored) |
| Android compile, lint, JVM tests | push the branch, then `gh workflow run android-compile-check.yml --ref feat/voice-lab` | not run |
| iOS compile (Xcode 26.5, no signing) | `gh workflow run ios-compile-check.yml --ref feat/voice-lab` | not run |

## 6. Getting it on the phones

Mobile release on this ref (no workflow change; `workflow_dispatch` runs the workflow file of the chosen ref):
`gh workflow run mobile-release.yml --ref feat/voice-lab -f version=<the version of the latest main build> -f
upload_play=true -f upload_testflight=true` (after the branch is pushed and both compile checks are green).

What to know before running it:

- **Version and build number**: the build number is the workflow run number, shared by every ref, so the next run
  from `main` is higher and replaces the lab build on both tracks. Pass the same marketing version as the latest
  `main` build (without `version` the workflow takes `code/mobile/package.json`, `0.1.0`); App Store Connect refuses a
  marketing version lower than one already approved for release (none so far, UNVERIFIED for this account).
- **No tag, no GitHub release**: the `github-release` job runs only for `mobile-v*` tags; a manual run creates none.
  The Gradle cache is read-only outside `main` (slower, harmless).
- **Signing and provisioning**: unchanged. Speech recognition and the microphone need no entitlement or App ID
  capability, so the existing App Store profiles (App Group, `aps-environment`) still match. The secrets are
  repository secrets with no environment protection, so a run on this ref can read them.
- **iOS upload**: both purpose strings are in `Info.plist` (a missing one fails App Store Connect processing).
  TestFlight internal testers get the build without Beta App Review; do not add it to the external (public link)
  group, and check that no external group distributes new builds automatically.
- **Play internal track**: `RECORD_AUDIO` is a runtime permission with no Play declaration form (it is not one of the
  restricted permissions, UNVERIFIED against today's Play Console); the Data safety form says no audio is collected,
  which holds for on-device recognition, not clearly for the server engine (Google's recogniser receives the audio,
  design 49 section 3.4). Play may show a policy warning for the upload: read the Play Console inbox after it.
- **Policy text**: the shipped privacy policy says the app asks for the microphone only for the web cry monitor;
  testers of this build see a microphone prompt in the native app. Acceptable only because the build goes to the
  owner's internal testers (design 49 section 10 Q8: know who is on both lists).

## 7. Owner steps on each phone

Before: be on the Play internal testers list (Android) and an internal TestFlight tester (iPhone). Install the build
from the Play Store (internal testing) or TestFlight. Have a second device for the C3 noise (a crying-baby or white
noise sound, or the TV).

1. Open Lotties, sign in, Settings > Voice assistants > **Open the voice lab**.
2. Read **What this phone reports** for Português. Android: if the language is "Not installed, can be downloaded",
   tap **Download this language** (or download it in the phone's speech recognition settings; the path varies by
   phone), then **Check again**. iPhone: if on-device recognition is No, add Portuguese (Brazil) under Settings > General > Keyboard >
   Dictation languages, then Check again.
3. Engine **On device**, condition **C1** (quiet room, normal voice, phone 30-50 cm): tap **Speak**, allow the
   microphone (iPhone: speech recognition too) the first time, read the phrase as written, wait for the result, tap
   **Next**. Use **Retry** only if you misread the phrase (the first attempt counts anyway). 24 phrases.
4. **C2** night voice, phone on the bed or table about 1 m away: 8 phrases. **C3** with the noise playing: 24
   phrases. **C4**: turn on airplane mode, still On device: 5 phrases (each must produce text); turn it off after.
5. Engine **Server**, C1: read the warning, tick the box, 24 phrases (needs the network). Engine **Web**, C1, if
   "Web speech in this view" says Yes (expected on iPhone; on Android it may fail): tick its box, 24 phrases. Both
   are optional (they send the audio of these phrases to Google or Apple).
6. Language **English**, On device, C1: 11 phrases.
7. Open **Key logger**, press each Bluetooth button you want to try (mode c), note what shows.
8. **Export results** and save the file through the share sheet (it holds the test phrases and what the phone heard,
   nothing else); send it to the orchestrator. About 30 minutes per phone.

## 8. Unverified

Everything native: no compile here, no run on a device. In particular: the Kotlin and Swift compile on CI (lint
`NewApi` flow checks included); pt-BR on-device availability and what `checkRecognitionSupport` lists on the owner's
Android phone; whether `triggerModelDownload` shows a prompt; iOS `supportsOnDeviceRecognition` for pt-BR and the
quality of the 1.2 s end-of-speech rule; the iOS Speech error domains and codes the plugin maps (others become
`recognizer_error`); `webkitSpeechRecognition` inside Android WebView and WKWebView (and where its audio goes);
whether Capacitor's iOS WebView allows the web engine's microphone without a further prompt; Play's handling of the
upload. The parser's coverage is only as good as the vectors: the lab measures it on real recogniser output.
