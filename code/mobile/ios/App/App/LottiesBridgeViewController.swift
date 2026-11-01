import AuthenticationServices
import Capacitor
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
    }
}

/// Same operations as `LottiesSharedPlugin`; the message body is `{method, json?, ids?}`.
private final class LottiesMessageHandler: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        let body = message.body as? [String: Any] ?? [:]
        let method = body["method"] as? String ?? ""
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
