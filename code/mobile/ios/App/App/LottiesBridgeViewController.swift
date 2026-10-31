import Capacitor

/// The WebView controller of the app: Capacitor's own, plus the local plugin that talks to the App Group container.
class LottiesBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LottiesSharedPlugin())
    }
}
