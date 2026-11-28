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

**On-device recognition only (decision of 2026-11-28).** For the privacy wording "speech is recognised on the phone;
the app does not send or record audio", the lab has a single engine: the phone's own recogniser in on-device mode.
The server engine and the Web Speech engine that design 49 section 7.2 asked for were **removed on purpose**, with
their warnings and consent checkbox: there is no engine choice in the page, no Web Speech code in the bundle, and both
native plugins refuse `onDevice: false` and have no code that creates a server recogniser. The consequence is that
the spike no longer measures how much worse on-device is than the server (section 7.1's comparison), and section
7.4's "only the server engine passes" branch cannot happen: see section 3.

## 1. What is built

| Part | Where | What it does |
| --- | --- | --- |
| Switch | `code/web/src/voiceLab/featureFlag.ts` | `VITE_VOICE_LAB`, on only for `true` (the `VITE_CRY_MONITOR` pattern). The route and the Settings line import their chunks only behind the inline comparison `import.meta.env.VITE_VOICE_LAB === 'true'`, so a build without it has no lab chunk |
| Lab page | `code/web/src/voiceLab/` (`VoiceLabPage.tsx` at `/lab/voice`, inside the app shell) | Language and condition; what the phone reports; one phrase at a time with a large Speak button, the listening state and Cancel; after a result the n-best texts, the parsed command, pass or fail, latency, Retry and Next; the summary table; Export results; free try; key logger |
| Settings line | `voiceLab/VoiceLabLink.tsx` | One line in Settings > Voice assistants, only in the lab build |
| Parser v0 | `code/web/src/voice/` (`commandParser.ts`, `tokens.ts`, `numberWords.ts`, `lexicon.ts`, `speechHints.ts`) | Kept for Phase 1. Shared vectors `voice/handsFreeCommandVectors.json` |
| Speech adapter | `code/web/src/platform/speech.ts`, `speechTypes.ts` | `speechPlatform()`: the `LottiesSpeech` plugin inside the app (lazy `@capacitor/core`), always asked for on-device recognition; an answer not marked on-device is not used. In a browser: no engine |
| Android plugin | `code/mobile/android/app/src/main/java/app/lotties/app/speech/` (`LottiesSpeechPlugin.kt`, `SpeechCodes.kt` + JVM test) | Registered in `MainActivity.java`; `RECORD_AUDIO` and the `android.speech.RecognitionService` `<queries>` entry in `AndroidManifest.xml` |
| iOS plugin | `code/mobile/ios/App/App/LottiesSpeechPlugin.swift` | Registered in `LottiesBridgeViewController.swift`, added to `App.xcodeproj`; `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` (one string in English and Portuguese each; the speech one says recognition is on the iPhone only) in `Info.plist` |
| Guards | `voiceLab/onDeviceOnly.test.ts`, `voiceLabSwitch.test.tsx` | No source uses `SpeechRecognition`; the adapter always sends `onDevice: true`; the Kotlin plugin never calls `createSpeechRecognizer` and refuses `onDevice == false`; the Swift plugin always sets `requiresOnDeviceRecognition = true` and refuses `onDevice == false`; flag off: no route, no line, nothing in the app's static graph |
| Preview | `code/web/src/dev/VoiceLabPreview.tsx` (`/dev/voice-lab`, dev server with the flag only), `voiceLab/fakeSpeech.ts` | Scripted engine for tests and screenshots: `tests/e2e/design-review/voice-lab-preview.config.ts` |

Not built (section 7.2 allows it): iOS 26 `SpeechTranscriber` (deferred: it needs `AssetInventory`, an audio format
converter and an async analyzer loop that cannot be tried without Xcode; the CI's Xcode 26.5 could compile it, but a
wrong guess costs a macOS run and risks the whole build). Spoken answers (TTS), wake word, NFC. Server and Web
engines: removed (above).

## 2. The lab

- **Engine**: on the device only. When the phone cannot recognise the language on the device the lab says so
  (`on_device_unavailable`, `language_unavailable`) and records nothing; nothing is sent anywhere instead.
- **Phrases per run** (section 7.3): pt-BR C1 and C3 all 24, C2 `1, 7, 10, 12, 14, 16, 18, 21`, C4 `1, 7, 12, 16, 21`
  (61 utterances); English has no subsets: its 11 phrases (the 10 plus "four ounce bottle" parsed in the US system)
  in every condition, measured once in C1. Each run (condition, language) keeps its own position.
- **Attempts**: the first attempt of a phrase in a run is what the measures count; Retry replaces the attempt shown
  and increments a retry count shown on screen, in the table and in the export, so a retried failure stays visible.
  Recognition results count, and so do `no_match`, `speech_timeout`, `network`, `audio`, `timeout` and
  `recognizer_error` (no text, a failed attempt). Setup problems do not create an attempt: `denied`,
  `language_unavailable`, `on_device_unavailable`, `not_available`, `busy`, `cancelled`, `interrupted`.
- **Pass**: a command phrase passes when the parsed command and every slot equal the expected one; phrases 22 to 24
  pass when nothing would be logged. **Wrong action**: a logging command that is not the expected one (the two
  questions do not log). **Wrong amount**: a wrong action that logs a bottle with an amount that was not said.
- **Latency**: the recogniser's end of speech to the parsed result (parser time added). Android: `onEndOfSpeech`
  (after the system endpointer's silence) to `onResults`. iOS: buffer requests have no end-of-speech event, so the
  plugin ends the audio after 1.2 s without a new partial result; that moment is the end of speech. The 1.2 s (iOS)
  and the endpointer's wait (Android) are not in the number.
- **Summary** (section 7.4): per language and condition, plus "All" per language once there are two conditions:
  attempts, accuracy (target 90 % C1, 80 % C2 and C3), wrong actions and rate (target 2 % at most), wrong amounts
  (none in C1), 22-24 logged (none), latency median (1.5 s) and 90th percentile (3 s, nearest rank), attempts with
  text (C4: all), retries. Values below target are marked. At 360 px the table scrolls sideways inside its box.
- **Export results** (only when the person taps it): `lotties-voice-lab-YYYYMMDD-HHMM.json` through
  `platform/saveFile.ts` (share sheet in the app): format `lotties-voice-lab` v1, app version and commit, what the
  phone reported per language, every test-phrase record (phrase, expected, engine `on_device`, condition, retries,
  first and latest attempt: n-best texts, confidences, parsed result, pass, wrong action, latency, error) and the
  summary. **Free tries are never in it** (anything could have been said; tested in `VoiceLabPage.test.tsx`); they
  stay on screen (last 5) until the page closes, and the free-try panel says so.
- **Key logger**: while its panel is open, every `keydown` (key, code, time), the last 20.
- **Isolation**: the lab writes no event and nothing to Dexie, the outbox or the server, reads no baby data, calls
  no API, and logs nothing (no `console`, no `appLog`; the in-app Logs feature records only explicit `appLog`
  calls, of which the lab makes none). The native plugins log nothing either. Tested in `VoiceLabPage.test.tsx`
  (rendered with no data layer at all; console and app log spied).
- **What can leave the phone**: only the export, when the person shares it. The microphone audio goes to the
  phone's own recogniser (Android: the system's on-device recognition service, another app on the phone, design 49
  section 3.4; iOS: Apple's framework with `requiresOnDeviceRecognition`, which Apple documents as keeping the audio
  off the network) and the text comes back to the page's memory. The Android **Download this language** button calls
  `triggerModelDownload` on the on-device recogniser: it asks the system speech service to fetch its own language
  model for the locale (the service may show a prompt and downloads from its vendor, for example Google); the app
  sends no audio and no text, only the language tag in the request to the on-device service. `capabilities` only
  queries the phone (recogniser present, on-device service present, installed languages, permission states).

## 3. Pass or fail, without the server comparison

Section 7.4 applies to the on-device engine as written. The decision becomes: on-device passes on a platform -> **GO**
for mode (a) on that platform (Phase 1); on-device fails -> Phase 0b (embedded engines, design 49 section 7.7) and
meanwhile mode (c) without voice. Whether a server recogniser would have passed is not measured: the owner's
question Q1 (design 49 section 10) is answered "no" for now, and re-opening it would need a new build with a server
engine, a consent and a policy change. The en run is reported, not gated. C4 (airplane mode) now checks the only
engine: 5 of 5 must produce text.

## 4. Parser v0 (kept for Phase 1)

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

## 5. Native plugin `LottiesSpeech` v0

Methods: `capabilities({locale})`, `listenOnce({locale, onDevice: true, hints, maxResults, timeoutMs})`, `cancel()`,
`downloadModel({locale})`, event `speechState` (`ready`, `speech`, `processing`). Errors are rejected with the codes of
`platform/speechTypes.ts`; `onDevice: false` is rejected with `not_supported` before anything starts.

- Android: main thread only; permission alias `microphone` (`RECORD_AUDIO`) asked at the first Speak; needs API 31
  (`isOnDeviceRecognitionAvailable`, `createOnDeviceSpeechRecognizer`, `EXTRA_PREFER_OFFLINE`; below 31 the call is
  refused); on API 33+ the language is checked first with `checkRecognitionSupport` (installed, pending,
  downloadable) and must be installed; biasing `EXTRA_BIASING_STRINGS` on API 33+; `downloadModel` uses
  `triggerModelDownload` (API 34 with progress, API 33 fire and forget, below: `unsupported`). The default recogniser
  (`createSpeechRecognizer`, "likely to stream audio to remote servers") is never created. Busy on double start; a
  watchdog timeout; the recogniser destroyed on result, error, Cancel, timeout and `handleOnPause` /
  `handleOnDestroy`.
- iOS: speech recognition then microphone authorisation at the first Speak; every request sets
  `requiresOnDeviceRecognition = true` and a language without `supportsOnDeviceRecognition` is refused;
  `contextualStrings` (100 at most), `addsPunctuation` (iOS 16, so a question mark can refuse a question); audio
  session `.record` / `.measurement`, released with the engine and the tap on every way out, including the app going
  to the background and an audio interruption. iOS cannot start a language download: Settings > General > Keyboard >
  Dictation languages (and the Siri language) decide what is on the device.
- The web side also cancels on `visibilitychange` (hidden) and `pagehide`, and ignores a second tap while listening.

## 6. Checking it

| What | How | Result (2026-11-28) |
| --- | --- | --- |
| Web unit tests | `npm --prefix code/web test -- run` | The lab, parser and speech tests pass (825 in the touched folders after the on-device-only change; parser vectors and properties 704). Whole suite before the change: 5857 pass; one Settings test timed out under the full parallel load and passes alone; one suite cannot load locally (`@mui/icons-material` missing from this machine's node_modules, known) |
| Lint, format, types | `npm --prefix code/web run lint`, `npx prettier --check`, `tsc -p tsconfig.json --noEmit` | clean except the known local `@mui/icons-material` gap |
| No lab in a build without the flag | `npx vite build --outDir <tmp>` in code/web, then search the output for `LottiesSpeech`, `/lab/voice`, `lotties-voice-lab` | none found; `VoiceLabPage-*.js` and `VoiceLabLink-*.js` exist only in `vite build --mode native` (flag on). The catalogs still carry the `voiceLab.*` strings (the i18n chunks hold every feature's text, CLAUDE.md rule) |
| No Web Speech in the lab build | `vite build --mode native`, search for `SpeechRecognition` | none found |
| Screenshots | `cd tests/e2e && npx playwright test -c design-review/voice-lab-preview.config.ts` (port 5418) | `docs/design/screenshots/voice-lab-*.png` (gitignored) |
| Android compile, lint, JVM tests | push the branch, then `gh workflow run android-compile-check.yml --ref feat/voice-lab` | not run |
| iOS compile (Xcode 26.5, no signing) | `gh workflow run ios-compile-check.yml --ref feat/voice-lab` | not run |

## 7. Getting it on the phones

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
  restricted permissions, UNVERIFIED against today's Play Console). With on-device recognition only, no audio is
  collected (Play: data processed only on the device is not collected); whether handing the microphone to the
  system's on-device recognition service counts as sharing with another app on the device stays the open question of
  design 49 section 3.4. Play may show a policy warning for the upload: read the Play Console inbox after it.
- **Policy text**: the shipped privacy policy says the app asks for the microphone only for the web cry monitor;
  testers of this build see a microphone prompt in the native app. Acceptable only because the build goes to the
  owner's internal testers (design 49 section 10 Q8: know who is on both lists).

## 8. Owner steps on each phone

Before: be on the Play internal testers list (Android) and an internal TestFlight tester (iPhone). Install the build
from the Play Store (internal testing) or TestFlight. Have a second device for the C3 noise (a crying-baby or white
noise sound, or the TV).

1. Open Lotties, sign in, Settings > Voice assistants > **Open the voice lab**.
2. Read **What this phone reports** for Português. Android: if the language is "Not installed, can be downloaded",
   tap **Download this language** (or download it in the phone's speech recognition settings; the path varies by
   phone), then **Check again**. iPhone: if on-device recognition is No, add Portuguese (Brazil) under Settings >
   General > Keyboard > Dictation languages, then Check again. If on-device recognition stays No, the phone cannot
   take part: note it and stop (the lab never uses a server).
3. Condition **C1** (quiet room, normal voice, phone 30-50 cm): tap **Speak**, allow the microphone (iPhone: speech
   recognition too) the first time, read the phrase as written, wait for the result, tap **Next**. Use **Retry** only
   if you misread the phrase (the first attempt counts anyway). 24 phrases.
4. **C2** night voice, phone on the bed or table about 1 m away: 8 phrases. **C3** with the noise playing: 24
   phrases. **C4**: turn on airplane mode: 5 phrases (each must produce text); turn it off after.
5. Language **English**, C1: 11 phrases.
6. Open **Key logger**, press each Bluetooth button you want to try (mode c), note what shows.
7. **Export results** and save the file through the share sheet (it holds the test phrases and what the phone heard,
   not the free tries); send it to the orchestrator. About 25 minutes per phone.

## 9. Unverified

Everything native: no compile here, no run on a device. In particular: the Kotlin and Swift compile on CI (lint
`NewApi` flow checks included); pt-BR on-device availability and what `checkRecognitionSupport` lists on the owner's
Android phone; whether `triggerModelDownload` shows a prompt and where the service downloads from; iOS
`supportsOnDeviceRecognition` for pt-BR, whether on-device recognition starts while `isAvailable` is false (the
plugin does not require it), and the quality of the 1.2 s end-of-speech rule; the iOS Speech error domains and codes
the plugin maps (others become `recognizer_error`); Play's handling of the upload. The parser's coverage is only as
good as the vectors: the lab measures it on real recogniser output.
