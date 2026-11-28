# 49. Hands-free mode (design and spike plan, 2026-11-28)

Status: **design only, nothing built.** Research from primary sources on 2026-11-28 (sources in section 13; anything not
read on a primary source is marked UNVERIFIED). UI and visual design are the orchestrator's: section 9 lists screens,
states and questions only.

Problem: Alexa, Siri and Google Assistant gave poor results (Alexa pt-BR mostly fails on the invocation name, docs/ALEXA.md,
design 32 section 1). Parents want to log with busy hands, often at night with the baby in arms. Owner decisions: each
person picks a mode: **(a)** one tap on a huge button, then speak; **(b)** a wake word while the app is open and the screen
on (no locked-screen listening is promised); **(c)** a Bluetooth button or an NFC tag, no voice. Android and iPhone
(Capacitor 8 shell), the PWA too where possible. First commands: bottle with ml, breastfeeding (start a side, stop), sleep
(fell asleep, woke up), diaper (wet, dirty), two questions (milk today, last feed). pt-BR first, then en. Offline-first.

## 0. Recommendation in short

1. **Recognise speech inside the app, not through an assistant**, and parse the text **in the web app** with a pure,
   vector-tested TypeScript parser. The command runs through the **existing local write path** (Dexie + outbox, client
   GUID), so logging works offline and syncs later. The server assistant layer (`Application/Assistants`) is not called.
2. **Speech engine: the phone's own recogniser in on-device mode, through a small local Capacitor plugin**
   (`LottiesSpeech`, Kotlin + Swift inside `code/mobile`, the same pattern as `LottiesVoice` and `LottiesShared`).
   Android: `SpeechRecognizer.createOnDeviceSpeechRecognizer` (API 31+) with biasing strings (API 33+). iOS:
   `SFSpeechRecognizer` with `requiresOnDeviceRecognition` and `contextualStrings`, and `SpeechTranscriber` on iOS 26+.
   No third-party plugin: the MIT one is stalled and does not support SPM; the maintained one is MPL-2.0 (section 3.2).
3. **Audio stays on the device by default.** Server recognition (Google, Apple) is not used unless the owner decides
   otherwise after the spike. Apple itself says not to send health data to its server recogniser (section 3.4).
4. **Phase 0 first: a "voice lab" spike** in a lab build (section 7) that measures pt-BR command accuracy on the owner's
   own Android and iPhone, on-device vs server recognisers, quiet vs noisy vs night voice, with no event written and no
   audio leaving the phone in on-device mode. Effort **M**. Go/no-go before any product UI.
5. **Mode (a) ships first** (Phase 1). **Mode (c)** next (Phase 2): keyboard-type Bluetooth buttons need no native code;
   Android NFC needs a few lines; iOS NFC needs universal links and always shows a notification to tap. **Mode (b)** last
   (Phase 3, its own spike): an embedded keyword spotter on the cry monitor's audio pipeline; none of the engines checked
   has a ready pt-BR wake word with a usable licence (section 3.5).
6. The assistants' rules carry over (no advice, no dose, no free text stored, no names spoken, units setting, roles).
   Three need an owner decision: voice **undo**, the **`via`** origin marker, and whether server recognition is ever
   allowed (section 10).
7. Privacy: a new on-device microphone flow (`ON_DEVICE_FLOWS`), a policy text and version, the audit, the store forms,
   the Info.plist and manifest permissions. Listed for the planned policy rewrite; no legal file is edited here
   (section 6).

## 1. Scope of the first version

| Command | pt-BR examples | en examples | What it does (existing web function) |
| --- | --- | --- | --- |
| Bottle | "mamadeira de 120", "mamadeira de 90 ml de fórmula" | "bottle 120 ml", "120 ml bottle of formula" | `runTrayChoice` (Feed tray rules: "Time bottle feedings" makes it a running bottle, formula reference) |
| Breastfeed start | "peito esquerdo", "começou no peito direito" | "left side", "start nursing on the right" | `startNursing` (`now/nursing.ts`); no side said = `suggestedStartSide` |
| Breastfeed stop | "parou de mamar", "terminou a mamada" | "stop nursing" | `stopNursing` |
| Fell asleep / woke up | "dormiu", "pegou no sono", "acordou" | "fell asleep", "woke up" | `runSleepAction` (`now/sleepToggle.ts`, nap/night rule) |
| Diaper | "fralda de xixi", "fralda molhada", "fralda de cocô", "xixi e cocô" | "wet diaper", "dirty diaper", "wet and dirty" | `runTrayChoice` (the Diaper tray; the type's own options `WET`, `DIRTY`, `MIXED`, as the widget outbox drain) |
| Milk today | "quanto leite hoje", "quanto ela tomou hoje" | "how much milk today" | `now/todayStats.ts` `milk` and `now/milkToday.ts` (the Milk today card: drunk vs prepared from today's finished bottles) |
| Last feed | "quando foi a última mamada", "última mamada" | "when was the last feed" | the Now screen's last feed (`now/quickLog.ts` `lastAndLogTiles`) |
| Undo (to decide, section 5) | "desfazer", "cancela" | "undo" | the existing Undo of the toast (`UndoToken`) for the entry this mode just made |

Out of the first version, on purpose: medication (and never a dose), free-text notes, temperature, symptoms, any other
activity, any advice, choosing among several babies by name (the selected baby is used), locked-screen or background
listening.

## 2. What exists and what it gives us

| Piece | Where | Reuse |
| --- | --- | --- |
| Assistant command layer (Alexa, MCP; Siri and Android voice are MCP clients) | `Application/Assistants`, design 32; `code/mobile/*/voice`, `LottiesSiriIntents.swift`, design 37 sections 8 and 14 | Online only: a Siri or Android voice request with no network logs nothing (design 37 section 8). Reuse its **vocabulary and rules** (result codes, `AssistantLimits` 1-500 ml, field options as choices, no names), not its transport |
| Widget outbox (offline) | `code/web/src/widgets/outbox.ts`, Android `widgets/WidgetOutbox.kt`, iOS `LottiesIntents.swift` (offline intents, hidden from Shortcuts) | The offline path for native entry points (NFC, shortcuts): append an entry, the app drains it through the normal write path |
| Local write path | `db/eventCommands.ts`, `now/quickLog.ts`, `now/sleepToggle.ts`, `now/nursing.ts` | The command runner calls these; no new event type, no new payload shape |
| Permissions | `baby/permissions.ts` (`canLog`, `canControlTimer`, `canChangeEvent`) | Writes for Owner, Parent, Caregiver; a Caregiver's limits stay (someone else's nursing stays locked) |
| Units | `code/web/src/units` (`auto`, `metric`, `us`) | Parse "120" as ml or fl oz by the resolved system; speak back in it |
| Cry engine (being switched off behind `VITE_CRY_MONITOR`, branch `feat/disable-cry-monitor`, code kept) | `cry/capture.ts`, `captureWorklet.ts` (16 kHz mono frames), `classifier.worker.ts`, `engine.ts` (stop on pagehide, stall, lost mic), `cryMonitor/screenWakeLock.ts`, `monitorStorage.ts` (per-device consent), `support.ts`, `/models/cry/` same-origin hosting and SW cache, `legal/dataFlows.ts` `ON_DEVICE_FLOWS` | The base of an embedded engine and of the wake word (section 3.5): every engine wants 16 kHz mono. Change for speech: voice processing ON (echo cancellation keeps the app's own spoken answer out, noise suppression helps speech), the cry capture turns it off on purpose. YAMNet (MediaPipe, Apache-2.0) could veto a wake word while "Baby cry" or TV scores are high (to evaluate) |
| Native TTS | `voice/VoiceRunner.kt` (Android `TextToSpeech`) | The pattern for spoken confirmations on Android; `speechSynthesis` is missing in Android WebView (section 3.1) |
| Build flag pattern | `VITE_CRY_MONITOR` (`cryMonitor/featureFlag.ts`) | `VITE_VOICE_LAB` for the spike (section 7) |
| Release pipeline | `.github/workflows/mobile-release.yml` (manual, any ref; Play internal, TestFlight), docs/MOBILE-RELEASE.md | How the spike reaches the phones (section 7.5) |

Project minimums that matter: Android `minSdkVersion 24`, `targetSdkVersion 36`; iOS app target `IPHONEOS_DEPLOYMENT_TARGET
16.0` (widget 17.0); Capacitor 8.5.3, SPM for iOS (no CocoaPods).

## 3. Options

### 3.1 Speech-to-text

| Option | Where audio goes | Offline | pt-BR | Licence, size | Biasing | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Web Speech API in the WebView** | iOS WKWebView: Apple's speech service, the Siri engine (WebKit [S8]); whether on-device or server per request is UNVERIFIED. Chrome (PWA): Google, server based by default (MDN, UNVERIFIED for today's Chrome Android) | no (iOS: maybe) | to measure | OS, 0 MB | `phrases` and `processLocally` (Chrome 139+ desktop [S10]) are not in Android WebView, Chrome Android or Safari (BCD [S7]) | iOS WKWebView has `webkitSpeechRecognition` since 14.5 (BCD) but needs both usage strings and has reports of `service-not-allowed` [S9]. **Android WebView: BCD inherits Chrome's entry; real support is UNVERIFIED** and a community report needed a `RecognitionService` `<queries>` entry. Zero native code: worth measuring in the spike, not a base for the product |
| **Android `SpeechRecognizer`, on-device** [S1] | stays on the phone (the system recognition service) | yes | the language must be installed; `checkRecognitionSupport` and `triggerModelDownload` from API 33; pt-BR availability per phone UNVERIFIED | OS, 0 MB in the app | `EXTRA_BIASING_STRINGS` API 33 [S2] | `createOnDeviceSpeechRecognizer` and `isOnDeviceRecognitionAvailable` API 31 (Android 12). Below 31 only the default recogniser exists. Needs `RECORD_AUDIO` and the `RecognitionService` `<queries>` entry (API 30+). The docs say it is "not intended to be used for continuous recognition" |
| Android `SpeechRecognizer`, default | "likely to stream audio to remote servers" (Android docs [S1]) | no | good expected (Google), to measure | OS | `EXTRA_BIASING_STRINGS` API 33; `EXTRA_PREFER_OFFLINE` API 23 "may have no effect" [S2] | Reference in the spike only |
| **iOS `SFSpeechRecognizer`, on-device** [S3] | stays on the phone | yes | `supportsOnDeviceRecognition` per locale; pt-BR UNVERIFIED (runtime check) | OS, 0 MB | `contextualStrings`, at most 100 short phrases [S5] | `requiresOnDeviceRecognition` iOS 13+; Apple: on-device "won't be as accurate". Fits the iOS 16 target |
| iOS `SFSpeechRecognizer`, server | Apple servers | no | to measure | OS | `contextualStrings` | Apple [S4]: per-device daily limits, per-app throttling, one-minute tasks, and "Don't send passwords, health or financial data, and other sensitive speech for recognition" |
| **iOS `SpeechAnalyzer` + `SpeechTranscriber`** [S6] | model managed by the OS (`AssetInventory`); on-device is implied, not stated on the page I read | yes (once the model is installed) | `supportedLocales` at runtime; pt-BR UNVERIFIED | OS | `AnalysisContext` ("contextual information"), details UNVERIFIED | **iOS 26.0+ only**: behind `if #available(iOS 26, *)` with `SFSpeechRecognizer` as the fallback; the target stays 16 |
| Vosk small pt (embedded) [S15] | stays in the app | yes | `vosk-model-small-pt-0.3`, 31 MB, WER 32.6 (Common Voice) / 68.9 (CORAA) open vocabulary | Apache-2.0 code and model | a closed **grammar** (JSON phrase list + `[unk]`) on lookahead models; whether pt-0.3 supports it UNVERIFIED | Android AAR; **iOS library "available on request"**; WASM only through the third-party `vosk-browser` 0.0.8 (2022) [S34]. Best fit for a closed command set and for the wake word. The big pt model is GPLv3: never |
| whisper.cpp tiny / base (embedded) [S16] | stays in the app | yes | Whisper paper, Portuguese WER (full precision): FLEURS tiny 20.1 / base 13.0, Common Voice 9 35.2 / 23.7 | MIT code and weights; q5_1 32 MB (tiny) / 60 MB (base) | initial prompt, GBNF grammar | v1.9.6 (2026-11-23); iOS, Android, WASM examples. Not streaming: transcribe after the speech ends. Phone latency UNVERIFIED |
| sherpa-onnx + Parakeet-TDT 0.6b v3 / Nemotron 3.5 [S17] | stays in the app | yes | strong on benchmarks (Parakeet trained on European Portuguese: test pt-BR) | Apache-2.0 engine; models CC-BY-4.0 / OpenMDW-1.1; **~640 MB** | hotwords (transducers) | Too big for a phone app; a PC reference only. The Portuguese FastConformer is CC BY-NC (never); Kroko pt is CC-BY-SA |
| Moonshine [S33] | | | **no Portuguese STT** | MIT | | Out |
| Picovoice Leopard/Cheetah/Rhino [S20] | on device, but the AccessKey is validated online | partly | Portuguese listed | commercial terms; "no dedicated free or paid plans for personal or non-commercial use" | Rhino is speech-to-intent (ideal shape) | **Blocked** without a commercial agreement |

### 3.2 Capacitor plugins or our own

| Plugin | Version (date) | Capacitor 8 | Licence | Verdict |
| --- | --- | --- | --- | --- |
| `@capacitor-community/speech-recognition` [S11] | 7.0.1 (2025-06-09) | peer `>=7` only; issue #126 "support capacitor 8" open, no reply | MIT | **No**: no root `Package.swift` (the iOS project is SPM-only), no on-device flag, no phrase hints, open crash and Android 15 issues |
| `@capgo/capacitor-speech-recognition` [S12] | 8.6.0 (2026-11-17) | yes | **MPL-2.0** | Technically the closest (on-device options, iOS 26 `SpeechAnalyzer`, iOS `contextualStrings`; no Android biasing). MPL-2.0 is file-level copyleft; App Store distribution works in practice (Firefox for iOS is MPL-2.0), but it is outside design 12 section 11's MIT/Apache/BSD rule: owner decision. Not needed if we write our own |
| `@capacitor-community/text-to-speech` [S13] | 8.0.2 (2026-06-15) | yes | MIT | Possible for spoken answers; but Android TTS is already used natively (`VoiceRunner.kt`), so two methods in our own plugin avoid a dependency |
| Vosk / whisper plugins (`capacitor-offline-speech-recognition` 3.0.0, `capacitor-whisper` 0.2.1, `whisper-cpp-capacitor`) | various | partly | MIT | Immature or no visible source: **no** |
| **Own local plugin `LottiesSpeech`** [S14] | | | ours (AGPL) | **Recommended.** Capacitor documents local plugin classes registered in `MainActivity` and in a `CAPBridgeViewController` subclass (the project already does both). About one Kotlin and one Swift file plus a TypeScript interface behind `isNativeApp()`. Full control of on-device flags, biasing, n-best results, timing. Cost: written without Android Studio or Xcode on the dev machine, compiled by CI (`android-compile-check`, `ios-compile-check`, `mobile-release`) |

Plugin surface (proposal): `capabilities({locale})` (on-device available, language installed or downloadable, iOS 26
transcriber), `listenOnce({locale, onDevice, hints, maxResults})` resolving `{alternatives[], confidences[], endOfSpeechAt,
resultAt}` or a coded error (`denied`, `no_match`, `language_unavailable`, `busy`, `network`), `cancel()`, `speak({text,
locale})` (Android: an offline `Voice`, `isNetworkConnectionRequired()` false [S29]; iOS: `AVSpeechSynthesizer`). The
transcript goes to the parser and is then dropped: never stored, logged or sent.

### 3.3 Biasing the recogniser

Closed command set, so bias hard: iOS `contextualStrings` (up to 100 one- or two-word phrases: "mamadeira", "peito
esquerdo", "xixi", "cocô", "fralda", the numbers 30 to 240 by 10), Android `EXTRA_BIASING_STRINGS` (API 33+), whisper.cpp
initial prompt or a GBNF grammar, Vosk a grammar list. Whatever the engine, the parser reads the **n-best list** and takes
the first alternative that parses, numbers in digits or words ("cento e vinte", "120", "120ml"), and refuses values
outside 1-500 ml (`AssistantLimits`) instead of guessing.

### 3.4 Where the audio goes

| Engine | Audio | Text | Notes for the policy and the stores |
| --- | --- | --- | --- |
| Android on-device recogniser | the system recognition service on the phone (another app on the device, e.g. Google's speech services) | back to Lotties only | Play's Data safety: data only processed on the device is not "collected" [S27]; whether handing the microphone to the system service counts as "sharing with another app on the device" is an owner/lawyer question (Play says on-device transfers to another app must be disclosed as sharing) |
| iOS on-device (`SFSpeechRecognizer` on-device, `SpeechTranscriber`) | Apple's framework on the phone | back to Lotties only | Apple App Privacy: on-device processing is not collection (design 31 section 6) |
| Embedded engine (Vosk, whisper.cpp) | never leaves the app process | never leaves | cleanest; model downloaded from our own server like the cry model |
| Android default, iOS server, Web Speech in Chrome | Google or Apple servers | | a third party receives a child's care data spoken by the parent: a new recipient in the policy, a store form change, and against Apple's own advice for health data. Not recommended |
| Android TTS | a network voice would send the spoken sentence to the engine's servers | | pick an offline voice; iOS `AVSpeechSynthesizer` is on the device |

### 3.5 Wake word (mode b)

| Option | Licence | pt-BR | Platforms | Verdict |
| --- | --- | --- | --- | --- |
| openWakeWord [S18] | code Apache-2.0, **models CC BY-NC-SA 4.0** | training is English only | Python; no official mobile or JS | No |
| sherpa-onnx keyword spotting [S17] | Apache-2.0 engine, model terms unstated (English model trained on GigaSpeech, non-commercial access terms) | **no Portuguese model** | Android, WASM | No for pt-BR today |
| Picovoice Porcupine [S20] | commercial | Portuguese | all | Blocked (online AccessKey, no free tier for this use) |
| livekit-wakeword [S19] | Apache-2.0 code, weights, encoders | trainable from synthetic speech in any language; pt quality UNVERIFIED | Swift, browser JS (onnxruntime-web, so the WebView), Python; Android native not listed | Candidate; training needs a LiveKit Cloud project and a GPU (UNVERIFIED detail) |
| **Constrained continuous recognition with an embedded engine** (Vosk grammar: the wake phrase + `[unk]`) | Apache-2.0 | the wake phrase must use words in the model's vocabulary | Android AAR, WASM (third party), iOS on request | **Candidate, recommended to spike first**: no training, runs on the cry engine's 16 kHz pipeline in a worker |
| OS recognisers in a loop | | | | No: Android says not for continuous use; iOS tasks stop after a minute and the server variant has daily limits |

No false-activation or battery figures exist for pt-BR in any source read. Mitigations to design in: a two-step flow
(wake phrase, short tone, a 5 s command window that must parse), a spoken confirmation and Undo, optional YAMNet veto
while crying or TV dominates (to evaluate), screen on and phone plugged in at night (Screen Wake Lock works in Android
WebView 84+ and in WKWebView fully from 18.4, partly 16.4-18.3 [S28]; `@capacitor-community/keep-awake` 8.0.1, MIT, is
the native fallback).

### 3.6 Buttons and NFC (mode c)

| Entry | Android | iOS | PWA | New native code? |
| --- | --- | --- | --- | --- |
| Bluetooth button that types a **keyboard key** (page turners, macro buttons, remotes with a keyboard mode: Enter, Space, arrows, Page Down) | `keydown` in the WebView while the hands-free screen is open | same | same | **None** (which keys a given remote sends: UNVERIFIED per model; the lab's key logger shows it, section 7) |
| Camera **shutter remote** (HID Consumer Control "Volume Up" [S31]) | volume keys go to the Activity, not the page: a small `dispatchKeyEvent` override in `MainActivity`, only while the hands-free screen asks for it | **not supported**: no public API for volume presses outside camera capture, and guideline 2.5.9 rejects apps that alter the volume buttons | no | Android only, a few lines |
| Earbud play/pause | needs an active media session | needs a "now playing" audio session | no | not recommended |
| **NFC tag, Android** [S21] | a tag with a custom-scheme URI (for example `app.lotties.app://hands-free/diaper_wet`) dispatched as `NDEF_DISCOVERED` to `MainActivity` (manifest filter + `NFC` permission); Capacitor's App plugin forwards only `ACTION_VIEW` [S23], so a few lines forward the NDEF intent (or the native code appends straight to the widget outbox, offline, app closed). An https App Link tag needs no code but, since Android 16, arrives as `ACTION_VIEW`, and **Android 17 asks the user to tap an "open link" notification**; App Links need `assetlinks.json` (design 12 section 9, not built). Screen must be unlocked; Android 16 lets the user block NFC launches per app; Android 17 with targetSdk > 36 needs `DISPATCH_NFC_MESSAGE` on the activity | | | small |
| **NFC tag, iOS** [S22] | | background reading on iPhone XS+, **universal links or supported schemes only (no custom scheme)**, a notification the user must tap, unlock first. Needs the Associated Domains entitlement and `apple-app-site-association` (design 12 section 9; Apple portal step, profile regenerated); no Swift code (the scene delegate already forwards user activities). Alternative: a Shortcuts personal automation with an NFC trigger running a Lotties App Intent (documented only by third parties [S32], UNVERIFIED); the offline intents are hidden from Shortcuts today (`isDiscoverable = false`), the online MCP ones are visible | | config, or one-line intent changes |
| Launcher shortcuts / App Shortcuts (exist) | 12 static shortcuts (`shortcuts.xml`) run MCP calls: **online only** | 8 spoken App Shortcuts, MCP: online only | no | to work offline they would append to the widget outbox (small native change) |
| Back Tap, Action button (iPhone) | | can run a Shortcut (platform feature, not checked on Apple pages in this research) | | none if an offline intent is visible to Shortcuts |

Writing tags needs no code in Lotties (any NFC tool app writes a URI record); an in-app tag writer would need an NFC
plugin: Capawesome's is proprietary and paid, Capgo's is MPL-2.0, Exxili's (MIT, 0.0.14) has open crash and SPM issues
[S30]. Not in the first version.

## 4. Recommended architecture

```
 trigger: huge button (a) | wake phrase (b, later) | BT key, NFC, shortcut (c)
                │                                         │ (c) maps straight to a command
                ▼                                         │
 speech adapter (platform/speech.ts, lazy, behind isNativeApp())
   native: LottiesSpeech plugin (on-device recogniser; iOS 26 transcriber)
   web/PWA: none in v1 (keyboard keys only), unless Phase 0b finds an embedded engine
                │ n-best text + locale (never stored)
                ▼
 command parser (voice/commandParser.ts, pure; pt-BR and en grammars; units-aware; vectors)
                │ HandsFreeCommand {kind, slots} | not_understood | needs_more (bottle without ml)
                ▼  ◄────────────────────────────────────────────┘
 command runner (role check via baby/permissions.ts, then the existing local writes: Dexie + outbox, client GUID)
                │ HandsFreeResult {code, facts}: AssistantResult codes where they exist
                ▼
 feedback: t() sentence (Intl times and amounts, units system), on-screen text with Undo, earcon,
           speech (native TTS on Android, speechSynthesis or the plugin on iOS)
```

- **One command layer on the device, not two.** The parser and runner live in `code/web` (offline, both platforms, the
  PWA later). The server layer stays for remote adapters. Shared: the result codes (`bottle_logged`, `bottle_started`,
  `nursing_started`, `nursing_already_running`, `sleep_started`, `sleep_already_running`, `sleep_ended`,
  `no_running_sleep`, `diaper_logged`, `last_feed`, `no_feeds`, `bottle_today`, `not_allowed`, `choose_baby`; new local
  ones `nursing_stopped`, `no_running_nursing`, `not_understood`, `needs_amount`), the limits (bottle 1-500 ml) and the
  choices (the event fields' own options, `AssistantChoices` on the server, the synced event types on the web).
- **Shared vectors, the repo's pattern** (`cryReasonsVectors.json`, `unitsVectors.json`): `handsFreeCommandVectors.json`
  (utterance, locale, unit system, running timers -> expected command or none), run by `commandParser.test.ts`. If the
  wording of a spoken answer must match the Alexa sentence later, a second file (code + facts -> sentence en/pt-BR)
  can be checked by both `PortugueseAlexaLanguage` and the TS renderer; not needed for v1 (in-app answers are shorter).
- **Context-aware parsing**: "parou" stops the one running feed; with a feed and a sleep both running, or two feeds,
  the screen asks instead of guessing; "acordou" with no running sleep answers `no_running_sleep` (as Alexa).
- **Idempotency**: one client GUID per understood command, created before the write, so a double tap or a repeated
  result never logs twice; saying it again is a new entry (two bottles are two bottles, as design 32 section 5).
- (c) entries carry a fixed command id (`diaper_wet`, `sleep_toggle`, ...), validated against an allow-list (design 12
  section 8 rule: never a free path).

## 5. Rules that carry over, and the ones to decide

Carry over unchanged (CLAUDE.md "Voice assistants", "Assistants", design 32 sections 5 and 7):

- Nothing said is stored as text: every value is a number in range or one of the field's own options; the transcript is
  dropped after parsing, never logged, never in analytics (there is none) or crash reports.
- No advice, no "normal", no recommendation; answers are facts from the family's own log.
- No medication in v1; never a dose computed, suggested or spoken.
- Spoken and shown confirmations carry **no baby name** and no free text (formula names: "de fórmula"); the phone's
  speaker is heard in the room. `sayBabyName` is a server setting for remote assistants; v1 simply never says the name.
- The units setting decides how amounts are understood and said; storage stays metric.
- Roles: logging for Owner, Parent, Caregiver (`canLog`); a Viewer may ask the two questions only; the Caregiver limits
  of `canControlTimer` stay (someone else's nursing stays locked); a Doctor's patients never reach the parents' shell.
- The voice commands guide rule: the hands-free phrases join `docs/VOICE-COMMANDS.md` and `assistants/voiceCommands.ts`
  (a new assistant id, its own drift test against the parser's grammar), marked unverified until run on a real phone.
- The privacy policy rule and the showcase media rule apply to Phase 1 (sections 6 and 8).

To decide (section 10): **undo by voice** (CLAUDE.md says assistants never delete; this is the person's own app, so the
proposal is: "desfazer" only undoes the entry this mode just made, inside the same window as the toast's Undo, through
the same soft delete), the **`via` marker** (proposal `via: "voice"`, "Added by voice", which lets undo find its own entry
and makes misrecognitions traceable; needs a web origin string under `assistants.origin.*`; the server does not check
undeclared payload members, design 32 section 5.2), and
**server recognition** (proposal: never by default).

## 6. Privacy and legal impact (for the planned policy rewrite; no legal file edited here)

| Item | What Phase 1 needs |
| --- | --- |
| `legal/dataFlows.ts` | a second `ON_DEVICE_FLOWS` entry (`handsFree`: permission `microphone`, trigger `optIn`, off by default, consent per device by the roles that log (a Viewer for questions: to decide), raw signal `{stored: false, sent: false}`, model from the OS or our own server, no recipient, platforms `android` and `ios`). The type's `id` union and `platforms: 'web'[]` widen; `dataFlows.test.ts` changes on purpose |
| Policy text (both `privacy.<lang>.ts`) | what is listened to and when (only while the hands-free screen is open and listening, visible indicator), that audio and transcripts stay on the phone and are never recorded, stored or sent, what is saved (ordinary records, with the origin marker if decided), the people in the room, how to turn it off and withdraw; new version and date |
| Consent | per-device opt-in like the cry monitor (`{version, at}` in localStorage, cleared at sign-out). Whether the policy change is material or minor (`consentVersions.json` and `ConsentVersions`): owner/lawyer, with the rewrite |
| Audit (design 33) | a new section; the sentence "Native apps request only `android.permission.INTERNET`; the iOS `Info.plist` has no usage description (no ... microphone)" stops being true |
| Native config | Android `RECORD_AUDIO` and the `RecognitionService` `<queries>` entry; iOS `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` (purpose strings in en and pt-BR, Apple 5.1.1) |
| Store forms | Apple App Privacy and Play Data safety: no audio "collected" for on-device processing [S27]; the Android system-service question of section 3.4 |
| Store review [S25] | Apple 2.5.14 (explicit consent and a clear visual or audible indication while the microphone records), 5.1.1(iv) (an alternative when the microphone is refused: the buttons and the normal UI), 2.5.4 (no background audio mode: we do not listen in the background), 2.5.9 (no volume-button capture). Play: `RECORD_AUDIO` runtime permission only while in the foreground; **no microphone foreground service** (that would need a Play declaration and a demo video [S26]) |
| LGPD | a child's care data spoken by a parent, a child audible in the background: same reading as the cry monitor (art. 11, I and art. 14, §1, design 33 section 12), to confirm with the lawyer if the owner decides to ask (memory: lawyer only if really needed) |

Options that keep audio on the device: the on-device OS recognisers and the embedded engines. Anything server based is a
new third-party flow (Apple or Google as recipients), a different policy section, and not recommended.

## 7. Phase 0: the voice lab spike (measure before building)

### 7.1 Goal and question

Answer, on the owner's own Android phone and iPhone: **does an on-device recogniser understand the v1 commands in pt-BR
well enough to log without looking at the screen?** And how much worse is it than the server recogniser, in a quiet room,
with background noise, and in a night voice. Nothing is logged; nothing about a baby is read.

### 7.2 What to build (spike branch `spike/voice-lab`, never merged as is)

1. **Web, a lab page** `/lab/voice`, compiled only when `VITE_VOICE_LAB=true` (the `VITE_CRY_MONITOR` pattern), reached
   from a line in Settings > Voice assistants that exists only in that build. It shows one test phrase at a time, a big
   "speak" button, the n-best transcripts, the parsed command and pass/fail against the expected one, and a free-try
   mode. Per attempt it keeps: phrase id, engine, condition, n-best text, parsed command, pass, latency. Summary per
   engine and condition; **Export results** as JSON through the existing share sheet (`platform/saveFile.ts`). Results
   stay in memory and the exported file; nothing goes to Dexie, the outbox or the server. A **key logger** panel shows
   every `keydown` (key, code) to check Bluetooth buttons for mode (c).
2. **Parser v0** `voice/commandParser.ts` + `handsFreeCommandVectors.json` (pt-BR and en, units-aware): the real first
   version, kept for Phase 1.
3. **Native, `LottiesSpeech` v0** (section 3.2): `capabilities`, `listenOnce` with `onDevice` true/false, `hints`,
   `maxResults` 5. Android: on-device recogniser when available (API 31+), biasing on API 33+, `checkRecognitionSupport`
   to report whether pt-BR is installed and offer `triggerModelDownload`. iOS: `SFSpeechRecognizer` on-device when
   `supportsOnDeviceRecognition`, else reports "not available"; `SpeechTranscriber` when iOS 26+ and the locale is
   supported (optional in v0 if it costs more than a day). Manifest/Info.plist additions of section 6 on the branch only.
4. **Engine "web"**: `webkitSpeechRecognition` where the WebView has it (expected on iOS, to check on Android).

Not in the spike: wake word, NFC, TTS quality, any UI design.

### 7.3 Test phrases

Each phrase has an expected command; "none" means nothing must be logged. pt-BR (24):

| # | Phrase | Expected |
| --- | --- | --- |
| 1 | mamadeira de 120 ml | bottle 120 ml |
| 2 | mamadeira de 90 | bottle 90 ml |
| 3 | mamadeira de cento e cinquenta mililitros | bottle 150 ml |
| 4 | mamadeira de 60 ml de fórmula | bottle 60 ml, formula |
| 5 | mamadeira de 100 de leite materno | bottle 100 ml, breast milk |
| 6 | mamadeira de 210 | bottle 210 ml |
| 7 | peito esquerdo | nursing start, left |
| 8 | começou no peito direito | nursing start, right |
| 9 | mamando no lado esquerdo | nursing start, left |
| 10 | parou de mamar | nursing stop |
| 11 | terminou a mamada | nursing stop |
| 12 | dormiu | sleep start |
| 13 | o bebê pegou no sono | sleep start |
| 14 | acordou | woke up |
| 15 | ela acordou agora | woke up |
| 16 | fralda de xixi | diaper wet |
| 17 | fralda molhada | diaper wet |
| 18 | fralda de cocô | diaper dirty |
| 19 | xixi e cocô | diaper wet and dirty |
| 20 | quanto leite ela tomou hoje | ask milk today |
| 21 | quando foi a última mamada | ask last feed |
| 22 | mamadeira | needs amount (nothing logged) |
| 23 | que horas são | none |
| 24 | ela está chorando muito | none |

en (10): "bottle 120 ml", "90 ml bottle of formula", "left side", "start nursing on the right", "stop nursing", "she fell
asleep", "she woke up", "wet diaper", "dirty diaper", "how much milk today". With the unit system `us`: "four ounce bottle"
(bottle 4 fl oz, stored as ml).

Conditions: **C1** quiet room, normal voice, phone 30-50 cm away; **C2** night voice (quiet, low), phone on the bed or
table about 1 m away, phrases 1, 7, 10, 12, 14, 16, 18, 21; **C3** background noise: a crying-baby or white-noise sound
from another device at moderate volume, or the TV on. **C4** airplane mode: phrases 1, 7, 12, 16, 21 with the on-device
engine (it must still produce text).

Runs per phone: on-device engine C1 + C2 + C3 + C4 (about 61 utterances), server engine C1 (24), web engine C1 (24) when
present. About 110 utterances, 20-30 minutes per phone; en once in C1 (10).

### 7.4 Pass or fail

Per engine and phone, counting the parser over the n-best list:

| Measure | Pass |
| --- | --- |
| Command accuracy (kind and every slot exact: amount, side, diaper kind, formula/breast milk) | at least **90 %** in C1, at least **80 %** in C2 and in C3 |
| **Wrong actions** (a different command or value would have been logged; "not understood" is not wrong) | at most **2 %** overall and **none** with a wrong amount in C1 |
| Phrases 22-24 | none of them logs anything |
| Latency, end of speech to parsed result | median at most 1.5 s, 90th percentile at most 3 s |
| C4 airplane mode | 5 of 5 produce text |

Decision: on-device engine passes on a platform -> **GO** for mode (a) on that platform (Phase 1). Only the server engine
passes -> owner decision (audio to Apple or Google, offline lost; section 10 Q1) or Phase 0b. Nothing passes -> Phase 0b,
and meanwhile mode (c) without voice. en is reported, not gated.

### 7.5 How it reaches the phones

- Branch `spike/voice-lab` with `VITE_VOICE_LAB=true` set in that branch's `code/web/.env.native` (no workflow change:
  `workflow_dispatch` runs on any ref). Run **Mobile release** by hand on that ref with `upload_play` and
  `upload_testflight`. The run number is the build number, so the next build from `main` replaces it.
- iPhone: **TestFlight internal testers** get it without Beta App Review; do not add the build to the public-link
  (external) group. Android: the **Play internal** track. Everyone on these lists gets the build: the lab is hidden and
  the microphone is asked only inside it, but the owner should know who they are (section 10 Q8). Sideloading the APK
  artifact cannot update a Play-installed copy (docs/MOBILE-RELEASE.md section 5).
- Compile tries: run `android-compile-check` and `ios-compile-check` by hand on the branch when native code changes
  (by default CI and compile-check runs are cancelled after a push and only Mobile release is kept).
- Before the build, a free 10-minute look (not a measurement): dictate the phrase list with Gboard voice typing (offline
  language pack) and iPhone keyboard dictation into a notes app.

### 7.6 Does audio leave the phone during the spike?

- On-device engine: **no** (the system recogniser on the phone; C4 proves it works offline).
- Server engine: **yes, to Google or Apple**, only for the owner's own voice reading the fixed test phrases (no baby
  data); clearly labelled in the lab; can be skipped.
- Web engine on iOS: to Apple's speech service, on-device or server not known.
- Nothing reaches Lotties' servers. The exported JSON holds transcripts of test phrases only.

### 7.7 Phase 0b (optional, only if 0a fails on a platform, or to plan the PWA and the wake word)

The lab records the phrase list once per condition as 16 kHz WAV clips (the cry capture worklet, processing on; in the
Android shell `getUserMedia` makes Capacitor ask for `RECORD_AUDIO` [S24]), saved
in the app cache and exported as one file through the share sheet to the owner's computer; a script in `ml/voice/` runs
Vosk small pt (grammar and free), whisper.cpp tiny/base q5 (prompt) and Parakeet v3 (reference) and prints the same
measures. Clips hold the owner's voice and possibly the baby in the background: never committed (gitignored, like
`docs/samples/`), deleted after. Effort **S** to **M**.

### 7.8 Effort

**Phase 0a: M** (about 3-5 days): plugin Kotlin and Swift with CI compile tries 1.5-2 days, lab page, parser and vectors
1-1.5 days, build and notes 0.5 day; owner time 30 minutes per phone. **Phase 0b: S-M** (1-2 days).

## 8. Phased plan after the spike

| Phase | Content | Effort | Depends on |
| --- | --- | --- | --- |
| 1. Tap and speak (a) | `LottiesSpeech` hardened (permissions, errors, model download prompt), parser and runner, feedback (text, earcon, TTS), Undo, settings and per-device consent, Info.plist and manifest, policy and audit and dataFlows and version, voice commands guide and catalog, showcase media, unit and vector tests | **L** (6-9 days) | Phase 0 GO; owner answers Q1-Q5 |
| 2. Buttons and tags (c) | keyboard-key mapping on the hands-free screen (no native code, PWA too); Android volume-key capture; Android NFC (custom-scheme tags, native forward or widget outbox); offline iOS intents visible to Shortcuts (NFC automation, Back Tap, Action button); iOS NFC after universal links (design 12 section 9) | **M** | Phase 1 runner |
| 3. Wake word (b) | spike first: Vosk grammar spotter (and livekit-wakeword if Vosk fails) on the cry engine's pipeline; one night with TV and crying to count false activations per hour; battery per hour on both phones; then the build | **L** | Phase 1; a GO on false activations (proposal: at most 1 per 4 hours of TV or crying, and at least 90 % of wake phrases caught) |
| 4. PWA voice | only if Phase 0b finds an embedded engine that passes; else the PWA keeps (c) keyboard keys | **M** | 0b |

## 9. Screens, states and UX questions (for the orchestrator; no visual design here)

Screens: Settings > Hands-free (mode: off / tap and speak / wake word (later) / buttons and tags; speech language; spoken
answers on/off; sounds on/off); first-use explainer and per-device consent; the OS microphone (and iOS speech)
permission and its refusal; the **hands-free screen**; command examples (the voice commands page); buttons and tags
setup (learn a key, list of tag actions and the URIs to write); the day list's origin line; the lab (spike only).

States of the hands-free screen: idle; listening (visible and audible indicator, Apple 2.5.14); processing; understood
(confirmation shown and spoken, Undo with its window); needs more ("how many ml?"); not understood (retry, examples);
ambiguous ("stop which: feed or sleep?"); not allowed (Viewer writing); no baby / choose baby; language not installed
(download); microphone busy or lost; permission refused (alternatives); offline (must still work in on-device mode).

UX questions: tap to start with auto-stop on silence, or tap-tap; where the entry lives (Now, the dock, a Hub entry, the
lock-screen widget opening it); log at once or confirm first (Siri and widgets log at once, design 37 section 1); the
Undo window length; whether the transcript is shown; spoken answer volume and night behaviour; screen brightness while
the hands-free screen stays on; what a single, double and long press of a button mean; whether an answer to a question
says how fresh this phone's copy is (another caregiver's entries arrive with the next sync).

## 10. Open questions for the owner (with a recommendation)

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | May audio ever go to Apple or Google (server recognition) if on-device fails? | No by default. If ever, only as a per-device opt-in clearly labelled, after a policy change; Apple advises against sending health data |
| Q2 | Undo by voice ("desfazer")? Assistants never delete today | Yes, only for the entry this mode just made, inside the toast's Undo window, through the normal soft delete; keep "never delete" for remote assistants and say so in CLAUDE.md |
| Q3 | Mark hands-free entries with `via: "voice"` ("Added by voice")? | Yes: traceable misrecognitions and a safe undo |
| Q4 | Say the baby's name in spoken answers? | Never in v1 |
| Q5 | Log at once or confirm first? | Log at once when the parse is unambiguous, with a spoken and visible confirmation and Undo; ask on screen when ambiguous or out of range |
| Q6 | Wake word in v1? | No: Phase 3 with its own spike; tap and speak and buttons first |
| Q7 | Your phones: Android model and version, iPhone model and iOS version? | Needed before Phase 0 (Android 12+ for on-device, 13+ for biasing and language download; iOS 26 for `SpeechTranscriber`; iPhone XS+ for NFC) |
| Q8 | Who is on the TestFlight internal group and the Play internal track? | Only people who may receive the lab build; never the public TestFlight link |
| Q9 | Which Bluetooth button? | One that can send a keyboard key (page turner or macro button); test it with the lab's key logger. Volume-up shutter remotes: Android only |
| Q10 | NFC now or later? | Android in Phase 2; iOS once universal links exist (Apple portal step), and it always needs a notification tap |
| Q11 | Hands-free in the PWA? | Keyboard keys only, unless Phase 0b finds an embedded engine |
| Q12 | MPL-2.0 dependencies (Capgo plugins)? | Not needed: own local plugin |
| Q13 | Several babies (twins)? | The selected baby only in v1 |

## 11. Risks

- **pt-BR on-device quality** is unknown on both phones: the reason for Phase 0. Numbers ("cento e vinte" vs "cento e
  cinquenta", "dezesseis" vs "sessenta") are the likely wrong-action source; the range check, the spoken confirmation and
  Undo limit the damage.
- **On-device availability varies**: Android below 12 has no on-device recogniser; the pt-BR pack may need a download;
  iOS on-device per locale is not guaranteed; `SpeechTranscriber` needs iOS 26.
- **Native code without a device or IDE here**: Kotlin and Swift compiled only by CI; every try costs a run.
- **Night use**: whispering, a crying baby, white noise; the parent may not look at the screen, so a wrong log can go
  unnoticed (mitigation: always speak the confirmation in C2-like use, Undo, the origin marker).
- **Store review** of microphone use (2.5.14 indicator, purpose strings, an alternative path) and, if ever, a
  microphone foreground service on Play (avoid).
- **Policy timing**: the native apps' policy says no microphone today; nothing beyond the lab build may ship before the
  rewrite.
- **Wake word**: no ready pt-BR model with a usable licence; false activations from TV and crying unmeasured.

## 12. Unverified

Real Web Speech support in Android WebView and its reliability in WKWebView; whether iOS WebKit speech runs on-device;
pt-BR on-device availability on Android (per phone) and iOS (`supportsOnDeviceRecognition`, `SpeechTranscriber.
supportedLocales`); `AnalysisContext` biasing details; Vosk pt-0.3 grammar support and its vocabulary ("xixi", "cocô");
whisper.cpp latency on phones; livekit-wakeword pt quality and training needs; what each Bluetooth remote sends; Shortcuts
NFC automations, Back Tap and the Action button running a Lotties intent; whether the Android system recogniser counts
as sharing with another app for Play; Capacitor iOS handling of WKWebView microphone permission; Chrome Android's Web
Speech destination today. Nothing here ran on a device.

## 13. Sources (read 2026-11-28)

- [S1] Android `SpeechRecognizer`: https://developer.android.com/reference/android/speech/SpeechRecognizer
- [S2] Android `RecognizerIntent`: https://developer.android.com/reference/android/speech/RecognizerIntent
- [S3] Apple `requiresOnDeviceRecognition`: https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition
- [S4] Apple `SFSpeechRecognizer` (limits, sensitive data): https://developer.apple.com/documentation/speech/sfspeechrecognizer
- [S5] Apple `contextualStrings`: https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/contextualstrings
- [S6] Apple `SpeechTranscriber` and `SpeechAnalyzer` (iOS 26): https://developer.apple.com/documentation/speech/speechtranscriber, https://developer.apple.com/documentation/speech/speechanalyzer
- [S7] MDN browser-compat-data, SpeechRecognition and SpeechSynthesis: https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json, https://github.com/mdn/browser-compat-data/blob/main/api/SpeechSynthesis.json
- [S10] Chrome 139, on-device Web Speech (desktop): https://developer.chrome.com/blog/new-in-chrome-139
- [S8] WebKit, Safari 14.1 speech recognition: https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/
- [S9] WebKit bug 239816 (WKWebView speech): https://bugs.webkit.org/show_bug.cgi?id=239816
- [S11] https://github.com/capacitor-community/speech-recognition (issue 126)
- [S12] https://github.com/Cap-go/capacitor-speech-recognition
- [S13] https://github.com/capacitor-community/text-to-speech
- [S14] Capacitor custom native code: https://capacitorjs.com/docs/android/custom-code, https://capacitorjs.com/docs/ios/custom-code, https://capacitorjs.com/docs/plugins/creating-plugins
- [S15] Vosk models and install: https://alphacephei.com/vosk/models, https://alphacephei.com/vosk/install, grammar API https://github.com/alphacep/vosk-api/blob/master/src/vosk_api.h
- [S16] whisper.cpp: https://github.com/ggml-org/whisper.cpp; weights https://huggingface.co/ggerganov/whisper.cpp; Whisper paper https://arxiv.org/abs/2212.04356
- [S17] sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx; KWS models https://k2-fsa.github.io/sherpa/onnx/kws/pretrained_models/index.html; hotwords https://k2-fsa.github.io/sherpa/onnx/hotwords/index.html; Parakeet v3 https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3
- [S18] openWakeWord: https://github.com/dscripka/openWakeWord
- [S19] livekit-wakeword: https://github.com/livekit/livekit-wakeword
- [S20] Picovoice FAQ: https://picovoice.ai/docs/faq/general/; Porcupine: https://github.com/Picovoice/porcupine
- [S21] Android NFC basics (Android 16 and 17 changes): https://developer.android.com/develop/connectivity/nfc/nfc
- [S22] Apple background tag reading: https://developer.apple.com/documentation/corenfc/adding-support-for-background-tag-reading
- [S23] Capacitor App plugin (Android `appUrlOpen` only for `ACTION_VIEW`): https://github.com/ionic-team/capacitor-plugins/blob/main/app/android/src/main/java/com/capacitorjs/plugins/app/AppPlugin.java
- [S24] Capacitor `BridgeWebChromeClient` (WebView audio capture asks `RECORD_AUDIO`): https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/BridgeWebChromeClient.java
- [S25] App Store Review Guidelines (1.4.1, 2.5.4, 2.5.9, 2.5.14, 5.1.1, 5.1.2): https://developer.apple.com/app-store/review/guidelines/
- [S26] Android foreground service types and Play declarations: https://developer.android.com/develop/background-work/services/fgs/service-types, https://support.google.com/googleplay/android-developer/answer/13392821
- [S27] Play Data safety (collection, on-device processing, sharing with apps on the device): https://support.google.com/googleplay/android-developer/answer/10787469
- [S28] Screen Wake Lock compatibility: https://github.com/mdn/browser-compat-data/blob/main/api/WakeLock.json; https://github.com/capacitor-community/keep-awake
- [S29] Android TTS `Voice.isNetworkConnectionRequired`: https://developer.android.com/reference/android/speech/tts/Voice
- [S30] NFC plugins: https://capawesome.io/docs/plugins/nfc/, https://github.com/Cap-go/capacitor-nfc, https://github.com/Exxili/capacitor-nfc
- [S31] Shutter remotes as HID Volume Up: https://devzone.nordicsemi.com/f/nordic-q-a/92798/trigger-ios-shutter-via-ble-on-ios-16, https://developer.apple.com/forums/thread/764062
- [S32] Shortcuts NFC automations (third party): https://macmost.com/using-nfc-tags-and-tap-automations-to-trigger-shortcuts.html
- [S33] Moonshine: https://github.com/moonshine-ai/moonshine
- [S34] vosk-browser: https://github.com/ccoreilly/vosk-browser
- MPL-2.0 app in the App Store (Firefox for iOS licence): https://github.com/mozilla-mobile/firefox-ios
