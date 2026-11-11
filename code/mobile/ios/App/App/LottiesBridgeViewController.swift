import AuthenticationServices
import Capacitor
import UIKit
import WebKit
import WidgetKit

/// The WebView controller of the app: Capacitor's own, plus the two ways the web app reaches the App Group container:
/// the `LottiesShared` Capacitor plugin and a plain WebKit message handler (`webkit.messageHandlers.lotties`), which
/// answers with a promise and does not depend on Capacitor's plugin dispatch.
class LottiesBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LottiesSharedPlugin())
        bridge?.webView?.configuration.userContentController.addScriptMessageHandler(
            LottiesMessageHandler(), contentWorld: .page, name: "lotties")
        LottiesSilentPush.shared.webView = bridge?.webView
    }
}

/// Same operations as `LottiesSharedPlugin`, plus the Siri connection and the widgets' silent push (`LottiesSilentPush`);
/// the message body is `{method, json?, ids?, changed?}`.
private final class LottiesMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        let body = message.body as? [String: Any] ?? [:]
        let method = body["method"] as? String ?? ""
        if LottiesSilentPush.methods.contains(method) {
            Task { @MainActor in
                let result = await LottiesSilentPush.shared.handle(method, body)
                replyHandler(result.0, result.1)
            }
            return
        }
        if method.hasPrefix("siri") {
            Task { @MainActor in
                let result = await Self.siri(method, body)
                replyHandler(result.0, result.1)
            }
            return
        }
        let json = body["json"] as? String
        let ids = body["ids"] as? [String] ?? []
        DispatchQueue.global(qos: .userInitiated).async {
            let result: (Any?, String?) = Self.run(method, json: json, ids: ids)
            DispatchQueue.main.async { replyHandler(result.0, result.1) }
        }
    }

    /// The Siri connection (LottiesMcp.swift): `siriStatus`, `siriConnect {authority, clientId, mcpUrl}`, `siriDisconnect`.
    @MainActor
    private static func siri(_ method: String, _ body: [String: Any]) async -> (Any?, String?) {
        switch method {
        case "siriStatus":
            return (LottiesMcp.isConnected, nil)
        case "siriConnect":
            guard let authority = body["authority"] as? String, let clientId = body["clientId"] as? String,
                  let mcpUrl = body["mcpUrl"] as? String else { return (nil, "authority, clientId and mcpUrl are required") }
            do {
                try await LottiesMcp.connect(authority: authority, clientId: clientId, mcpUrl: mcpUrl)
                return (true, nil)
            } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
                return (false, nil)
            } catch {
                return (nil, "Siri sign-in failed (\(error))")
            }
        case "siriDisconnect":
            LottiesMcp.disconnect()
            return (false, nil)
        default:
            return (nil, "unknown method \(method)")
        }
    }

    private static func run(_ method: String, json: String?, ids: [String]) -> (Any?, String?) {
        switch method {
        case "writeSnapshot":
            guard let json, let data = json.data(using: .utf8) else { return (nil, "json is required") }
            guard LottiesShared.writeData(data, to: LottiesShared.snapshotFile) else {
                return (nil, "The App Group container is not available")
            }
            if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let language = object["language"] as? String {
                UserDefaults(suiteName: LottiesShared.groupId)?.set(language, forKey: LottiesText.languageKey)
            }
            WidgetCenter.shared.reloadAllTimelines()
            return ("ok", nil)
        case "readOutbox":
            let data = LottiesShared.readData(LottiesShared.outboxFile)
            return (data.flatMap { String(data: $0, encoding: .utf8) } ?? "[]", nil)
        case "removeOutbox":
            LottiesShared.removeOutbox(ids: Set(ids))
            return ("ok", nil)
        case "clearAll":
            LottiesShared.clearAll()
            LottiesMcp.disconnect()
            WidgetCenter.shared.reloadAllTimelines()
            return ("ok", nil)
        case "diagnose":
            let container = LottiesShared.containerURL != nil
            let snapshot = LottiesShared.readData(LottiesShared.snapshotFile)?.count ?? -1
            let outbox = LottiesShared.readData(LottiesShared.outboxFile)?.count ?? -1
            return ("container \(container ? "ok" : "missing"), snapshot \(snapshot < 0 ? "none" : "\(snapshot) B"), outbox \(outbox < 0 ? "none" : "\(outbox) B")", nil)
        default:
            return (nil, "unknown method \(method)")
        }
    }
}

/// The widgets' silent push on iOS (docs/design/37b-widget-silent-push.md section 5). The web app asks, through the
/// `lotties` message handler, whether a widget is installed (`widgetsInstalled`) and for this install's APNs token
/// (`pushToken`: `registerForRemoteNotifications`, no permission prompt: background pushes need none) and registers it
/// with the API itself. A background push whose payload is `{"lotties": {"t": "sync"}}` is handed to the WebView as the
/// window event `lotties:remote-change`; the web app pulls the sync, rewrites the snapshot (which reloads the widgets)
/// and answers `silentPushDone {changed}`, which ends the background time iOS gave (about 30 seconds; answered after 25
/// at the latest). Without a WebView (iOS launched the app in the background: no scene, so no bridge) nothing can be
/// synced and the push is answered with no data at once (design 37b section 5.3, the cold path).
/// Needs the `aps-environment` entitlement and the `remote-notification` background mode (owner steps, design 37b
/// section 10); without them the token request fails and the web app registers nothing.
/// UNVERIFIED: written without Xcode, never run on a device.
@MainActor
final class LottiesSilentPush {
    static let shared = LottiesSilentPush()
    nonisolated static let methods: Set<String> = ["widgetsInstalled", "pushToken", "silentPushDone"]

    private static let remoteChangeScript = "window.dispatchEvent(new CustomEvent('lotties:remote-change'))"
    private static let answerWithin: TimeInterval = 25
    private static let tokenWithinNanoseconds: UInt64 = 10_000_000_000

    /// Builds run from Xcode get sandbox tokens; TestFlight and App Store builds (Release) get production ones.
    static var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    weak var webView: WKWebView?
    private var token: String?
    private var tokenWaiters: [CheckedContinuation<String?, Never>] = []
    private var pending: [(UIBackgroundFetchResult) -> Void] = []
    private var pendingTimeout: DispatchWorkItem?

    func handle(_ method: String, _ body: [String: Any]) async -> (Any?, String?) {
        switch method {
        case "widgetsInstalled":
            return (await widgetsInstalled(), nil)
        case "pushToken":
            guard let token = await requestToken() else { return (nil, nil) }
            return (["channel": "apns", "token": token, "apnsEnvironment": Self.apnsEnvironment], nil)
        case "silentPushDone":
            finishPending((body["changed"] as? Bool) == true ? .newData : .noData)
            return ("ok", nil)
        default:
            return (nil, "unknown method \(method)")
        }
    }

    /// `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`: the token as lower-case hex.
    func didRegister(deviceToken: Data) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        resumeTokenWaiters(token)
    }

    /// No entitlement, a simulator, no network: the last token known (or none).
    func didFailToRegister() {
        resumeTokenWaiters(token)
    }

    /// `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`.
    func didReceive(_ userInfo: [AnyHashable: Any], completion: @escaping (UIBackgroundFetchResult) -> Void) {
        guard let lotties = userInfo["lotties"] as? [String: Any], lotties["t"] as? String == "sync" else {
            completion(.noData)
            return
        }
        guard let webView else {
            completion(.noData)
            return
        }
        pending.append(completion)
        armTimeout()
        webView.evaluateJavaScript(Self.remoteChangeScript) { _, error in
            guard error != nil else { return }
            Task { @MainActor in LottiesSilentPush.shared.finishPending(.failed) }
        }
    }

    private func widgetsInstalled() async -> Bool {
        await withCheckedContinuation { continuation in
            WidgetCenter.shared.getCurrentConfigurations { result in
                let widgets = (try? result.get()) ?? []
                continuation.resume(returning: !widgets.isEmpty)
            }
        }
    }

    /// Asks iOS for the token at every call (Apple: register at every launch, tokens change) and waits up to 10 seconds.
    private func requestToken() async -> String? {
        await withCheckedContinuation { continuation in
            tokenWaiters.append(continuation)
            guard tokenWaiters.count == 1 else { return }
            UIApplication.shared.registerForRemoteNotifications()
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: Self.tokenWithinNanoseconds)
                LottiesSilentPush.shared.resumeTokenWaiters(LottiesSilentPush.shared.token)
            }
        }
    }

    private func resumeTokenWaiters(_ value: String?) {
        let waiters = tokenWaiters
        tokenWaiters = []
        waiters.forEach { $0.resume(returning: value) }
    }

    private func armTimeout() {
        pendingTimeout?.cancel()
        let timeout = DispatchWorkItem {
            Task { @MainActor in LottiesSilentPush.shared.finishPending(.noData) }
        }
        pendingTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.answerWithin, execute: timeout)
    }

    private func finishPending(_ result: UIBackgroundFetchResult) {
        pendingTimeout?.cancel()
        pendingTimeout = nil
        let handlers = pending
        pending = []
        handlers.forEach { $0(result) }
    }
}
