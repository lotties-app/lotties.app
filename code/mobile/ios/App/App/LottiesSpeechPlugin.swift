import AVFoundation
import Capacitor
import Speech
import UIKit

/// Capacitor plugin `LottiesSpeech` v0 (code/web/src/platform/speech.ts; docs/design/49a-voice-lab.md, the experimental
/// voice test, opt-in in Settings). One recognition at a time with `SFSpeechRecognizer`, on the device only: every
/// request sets `requiresOnDeviceRecognition = true` (Apple: the request never sends audio over the network), a
/// language without on-device support (`supportsOnDeviceRecognition`) is refused (`on_device_unavailable`), and
/// `onDevice: false` is refused (`not_supported`). This plugin sends no audio or text anywhere.
/// The hints go in `contextualStrings` (at most 100). iOS has no end-of-speech detection for buffer requests: the plugin
/// ends the audio after `silenceSeconds` without a new partial result, which is the `endOfSpeechAt` it reports. The
/// microphone (audio engine, tap, audio session) is released on every way out: result, error, Cancel, timeout, the app
/// going to the background, an audio interruption. Nothing heard is logged or kept here. `SpeechTranscriber` (iOS 26)
/// is not used in v0. UNVERIFIED: written without Xcode, compiled by CI only, never run on a device.
@objc(LottiesSpeechPlugin)
public class LottiesSpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LottiesSpeechPlugin"
    public let jsName = "LottiesSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listenOnce", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
    ]

    private static let silenceSeconds: TimeInterval = 1.2
    private static let finalResultSeconds: TimeInterval = 4

    private struct Request {
        let locale: String
        let maxResults: Int
        let timeout: TimeInterval
        let hints: [String]
    }

    private final class Session {
        let call: CAPPluginCall
        let recognizer: SFSpeechRecognizer
        let engine: AVAudioEngine
        let request: SFSpeechAudioBufferRecognitionRequest
        let maxResults: Int
        let startedAt: Int
        var task: SFSpeechRecognitionTask?
        var latest: SFSpeechRecognitionResult?
        var lastPartialAt: Int?
        var endOfSpeechAt: Int?
        var audioRunning = false
        var silence: DispatchWorkItem?
        var watchdog: DispatchWorkItem?
        var finalWait: DispatchWorkItem?

        init(
            call: CAPPluginCall, recognizer: SFSpeechRecognizer, engine: AVAudioEngine,
            request: SFSpeechAudioBufferRecognitionRequest, maxResults: Int, startedAt: Int
        ) {
            self.call = call
            self.recognizer = recognizer
            self.engine = engine
            self.request = request
            self.maxResults = maxResults
            self.startedAt = startedAt
        }
    }

    // Main queue only: the running recognition, or a start still waiting for the permissions.
    private var session: Session?
    private var starting: CAPPluginCall?
    // Bumped by every cancel: a permission answer that arrives after a cancel starts nothing.
    private var generation = 0
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        let center = NotificationCenter.default
        observers.append(
            center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) {
                [weak self] _ in
                self?.stopAll(code: "interrupted", message: "The app left the screen")
            })
        // Scene-based apps post the scene's notification; the app-wide one is observed too (stopping twice is harmless).
        observers.append(
            center.addObserver(forName: UIScene.didEnterBackgroundNotification, object: nil, queue: .main) {
                [weak self] _ in
                self?.stopAll(code: "interrupted", message: "The app left the screen")
            })
        observers.append(
            center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) {
                [weak self] note in
                guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
                self?.stopAll(code: "interrupted", message: "The audio was interrupted")
            })
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    @objc func capabilities(_ call: CAPPluginCall) {
        guard let tag = call.getString("locale"), !tag.isEmpty else {
            call.reject("locale is required", "not_supported")
            return
        }
        DispatchQueue.main.async {
            let recognizer = SFSpeechRecognizer(locale: Locale(identifier: tag))
            let supported = SFSpeechRecognizer.supportedLocales().contains { Self.sameLanguage($0.identifier, tag) }
            let onDevice = recognizer?.supportsOnDeviceRecognition ?? false
            var answer: [String: Any] = [
                "platform": "ios",
                "osVersion": UIDevice.current.systemVersion,
                "recognitionAvailable": recognizer?.isAvailable ?? false,
                "onDeviceAvailable": onDevice,
                // iOS has no separate download state for the recogniser: on-device support means installed.
                "languageInstalled": onDevice,
                "canDownload": false,
                "biasing": true,
                "microphonePermission": Self.microphoneStatus(),
                "speechPermission": Self.speechStatus(),
            ]
            if recognizer == nil || !supported {
                answer["onDeviceReason"] = "locale_unsupported"
            } else if !onDevice {
                answer["onDeviceReason"] = "no_on_device_model"
            }
            call.resolve(answer)
        }
    }

    @objc func listenOnce(_ call: CAPPluginCall) {
        guard let tag = call.getString("locale"), !tag.isEmpty else {
            call.reject("locale is required", "not_supported")
            return
        }
        if call.getBool("onDevice") == false {
            // Server recognition does not exist in this plugin (docs/design/49a-voice-lab.md).
            call.reject("Only on-device recognition is available", "not_supported")
            return
        }
        let request = Request(
            locale: tag,
            maxResults: min(max(call.getInt("maxResults") ?? 5, 1), 10),
            timeout: Double(min(max(call.getInt("timeoutMs") ?? 15_000, 3_000), 60_000)) / 1000,
            hints: Array((call.getArray("hints", String.self) ?? []).filter { !$0.isEmpty }.prefix(100)))
        DispatchQueue.main.async {
            guard self.session == nil, self.starting == nil else {
                call.reject("Already listening", "busy")
                return
            }
            self.starting = call
            let ticket = self.generation
            Self.ensurePermissions { granted in
                guard ticket == self.generation, self.starting === call else { return }
                self.starting = nil
                guard granted else {
                    call.reject("The speech recognition or microphone permission was refused", "denied")
                    return
                }
                self.begin(call, request)
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopAll(code: "cancelled", message: "Cancelled")
            call.resolve()
        }
    }

    /// iOS downloads on-device speech models itself (Settings, keyboard dictation languages): nothing to start here.
    @objc func downloadModel(_ call: CAPPluginCall) {
        call.resolve(["status": "unsupported"])
    }

    // MARK: - Recognition (main queue)

    private func begin(_ call: CAPPluginCall, _ request: Request) {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: request.locale)) else {
            call.reject("This language is not supported", "language_unavailable")
            return
        }
        guard recognizer.supportsOnDeviceRecognition else {
            call.reject("No on-device recognition for this language", "on_device_unavailable")
            return
        }
        let audio = AVAudioSession.sharedInstance()
        do {
            try audio.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            call.reject("The microphone could not be used", "audio")
            return
        }
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            try? audio.setActive(false, options: .notifyOthersOnDeactivation)
            call.reject("No microphone input", "audio")
            return
        }
        let speech = SFSpeechAudioBufferRecognitionRequest()
        speech.shouldReportPartialResults = true
        speech.requiresOnDeviceRecognition = true
        speech.contextualStrings = request.hints
        // A question mark helps the parser refuse questions ("ela dormiu?").
        speech.addsPunctuation = true
        let current = Session(
            call: call, recognizer: recognizer, engine: engine, request: speech, maxResults: request.maxResults,
            startedAt: Self.nowMs())
        session = current
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            speech.append(buffer)
        }
        engine.prepare()
        do {
            try engine.start()
            current.audioRunning = true
        } catch {
            input.removeTap(onBus: 0)
            finish(current) { $0.call.reject("The microphone could not start", "audio") }
            return
        }
        current.task = recognizer.recognitionTask(with: speech) { [weak self] result, error in
            DispatchQueue.main.async { self?.handle(current, result, error) }
        }
        let watchdog = DispatchWorkItem { [weak self] in self?.timedOut(current) }
        current.watchdog = watchdog
        DispatchQueue.main.asyncAfter(deadline: .now() + request.timeout, execute: watchdog)
        notify(current, "ready")
    }

    private func handle(_ current: Session, _ result: SFSpeechRecognitionResult?, _ error: Error?) {
        guard session === current else { return }
        if let result {
            if current.latest == nil { notify(current, "speech") }
            current.latest = result
            if result.isFinal {
                complete(current, result)
                return
            }
            current.lastPartialAt = Self.nowMs()
            if current.endOfSpeechAt == nil { scheduleEndOfSpeech(current) }
            return
        }
        if let error {
            let code = Self.errorCode(error)
            finish(current) { $0.call.reject("Speech recognizer error \(Self.errorName(error))", code) }
        }
    }

    /// Ends the audio after `silenceSeconds` with no new partial result: the end of speech.
    private func scheduleEndOfSpeech(_ current: Session) {
        current.silence?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.endSpeech(current) }
        current.silence = item
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.silenceSeconds, execute: item)
    }

    private func endSpeech(_ current: Session) {
        guard session === current, current.endOfSpeechAt == nil else { return }
        current.endOfSpeechAt = Self.nowMs()
        notify(current, "processing")
        stopAudio(current)
        current.request.endAudio()
        // The final result follows; if it does not, the last partial result is the answer.
        let wait = DispatchWorkItem { [weak self] in
            guard let self, self.session === current else { return }
            if let latest = current.latest {
                self.complete(current, latest)
            } else {
                self.finish(current) { $0.call.reject("No answer in time", "timeout") }
            }
        }
        current.finalWait = wait
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.finalResultSeconds, execute: wait)
    }

    private func timedOut(_ current: Session) {
        guard session === current else { return }
        if current.latest == nil {
            finish(current) { $0.call.reject("No speech was heard", "speech_timeout") }
        } else if current.endOfSpeechAt == nil {
            endSpeech(current)
        }
    }

    private func complete(_ current: Session, _ result: SFSpeechRecognitionResult) {
        let resultAt = Self.nowMs()
        let transcriptions = Array(result.transcriptions.prefix(current.maxResults))
        let alternatives = transcriptions.map { $0.formattedString }
        // The mean segment confidence; -1 when iOS gives none (partial results have 0).
        let confidences: [Double] = transcriptions.map { transcription in
            let segments = transcription.segments
            guard !segments.isEmpty else { return -1 }
            let mean = segments.map { Double($0.confidence) }.reduce(0, +) / Double(segments.count)
            return mean > 0 ? mean : -1
        }
        let endOfSpeechAt = current.endOfSpeechAt ?? current.lastPartialAt ?? resultAt
        finish(current) {
            $0.call.resolve([
                "alternatives": alternatives,
                "confidences": confidences,
                "startedAt": $0.startedAt,
                "endOfSpeechAt": endOfSpeechAt,
                "resultAt": resultAt,
                "onDevice": true,
            ])
        }
    }

    /// Ends `current` once: timers stop, the task is cancelled, the microphone and the audio session are released.
    private func finish(_ current: Session, _ settle: (Session) -> Void) {
        guard session === current else { return }
        session = nil
        current.silence?.cancel()
        current.watchdog?.cancel()
        current.finalWait?.cancel()
        current.task?.cancel()
        current.task = nil
        stopAudio(current)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        settle(current)
    }

    private func stopAudio(_ current: Session) {
        guard current.audioRunning else { return }
        current.audioRunning = false
        current.engine.stop()
        current.engine.inputNode.removeTap(onBus: 0)
    }

    private func stopAll(code: String, message: String) {
        generation += 1
        if let pending = starting {
            starting = nil
            pending.reject(message, code)
        }
        if let current = session {
            finish(current) { $0.call.reject(message, code) }
        }
    }

    private func notify(_ current: Session, _ state: String) {
        guard session === current else { return }
        notifyListeners("speechState", data: ["state": state])
    }

    // MARK: - Helpers

    private static func nowMs() -> Int {
        Int((Date().timeIntervalSince1970 * 1000).rounded())
    }

    private static func sameLanguage(_ a: String, _ b: String) -> Bool {
        let normalize = { (tag: String) in tag.replacingOccurrences(of: "_", with: "-").lowercased() }
        return normalize(a) == normalize(b)
    }

    /// Speech recognition first, then the microphone; each prompt appears only once (iOS remembers the answer).
    private static func ensurePermissions(_ done: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else {
                    done(false)
                    return
                }
                requestMicrophone { granted in
                    DispatchQueue.main.async { done(granted) }
                }
            }
        }
    }

    private static func requestMicrophone(_ done: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: done)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(done)
        }
    }

    private static func speechStatus() -> String {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    private static func microphoneStatus() -> String {
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: return "granted"
            case .denied: return "denied"
            case .undetermined: return "prompt"
            @unknown default: return "prompt"
            }
        }
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted: return "granted"
        case .denied: return "denied"
        case .undetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    /// Domain and code only (never the text heard).
    private static func errorName(_ error: Error) -> String {
        let ns = error as NSError
        return "\(ns.domain) \(ns.code)"
    }

    /// Speech framework errors as the web app's codes (domains and codes as observed in Apple's frameworks; UNVERIFIED).
    private static func errorCode(_ error: Error) -> String {
        let ns = error as NSError
        switch (ns.domain, ns.code) {
        case ("kAFAssistantErrorDomain", 1110), ("kAFAssistantErrorDomain", 203):
            return "no_match"
        case ("kAFAssistantErrorDomain", 216), ("kAFAssistantErrorDomain", 301):
            return "cancelled"
        case ("kLSRErrorDomain", 102):
            return "language_unavailable"
        case ("kLSRErrorDomain", 201):
            return "not_available"
        default:
            return "recognizer_error"
        }
    }
}
