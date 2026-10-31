import Capacitor
import WidgetKit

/// Capacitor plugin `LottiesShared` (code/web/src/widgets/widgetBridge.ts): the web app writes the widget snapshot and
/// drains the outbox the Siri intents and the widget buttons fill, both in the App Group container.
@objc(LottiesSharedPlugin)
public class LottiesSharedPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LottiesSharedPlugin"
    public let jsName = "LottiesShared"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readOutbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeOutbox", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAll", returnType: CAPPluginReturnPromise),
    ]

    @objc func writeSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8) else {
            call.reject("json is required")
            return
        }
        guard LottiesShared.writeData(data, to: LottiesShared.snapshotFile) else {
            call.reject("The App Group container is not available")
            return
        }
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func readOutbox(_ call: CAPPluginCall) {
        let data = LottiesShared.readData(LottiesShared.outboxFile)
        let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        call.resolve(["json": json])
    }

    @objc func removeOutbox(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        LottiesShared.removeOutbox(ids: Set(ids))
        call.resolve()
    }

    @objc func clearAll(_ call: CAPPluginCall) {
        LottiesShared.clearAll()
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
