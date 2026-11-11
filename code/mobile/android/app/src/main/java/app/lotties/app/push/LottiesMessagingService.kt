package app.lotties.app.push

import android.util.Log
import app.lotties.app.widgets.WidgetRefresher
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Receives the API's content-free FCM data message (docs/design/37b-widget-silent-push.md sections 3, 5.2 and 9) and
 * hands it to the app's live WebView through [SilentPushRelay]: the page pulls the sync, the widget runner rewrites the
 * snapshot (the plugin's `writeSnapshot`, whose listener asks [WidgetRefresher] to render) and answers `silentPushDone`.
 * This method runs on Firebase's worker thread and keeps the process up until that answer (at most [ANSWER_WITHIN_MS])
 * and the render it asked for ([RENDER_WITHIN_MS]); Firebase allows about 20 seconds.
 *
 * Warm path only (owner decision 2026-11-11, design 37b section 12): when the process was started for this message
 * there is no activity, no WebView and no data, so the widgets stay as they are until the app opens.
 *
 * Inert without Firebase: with no google-services.json in the build no token exists, so FCM never delivers here.
 * Logs carry the outcome only, never the message, the token or anything about a baby.
 * UNVERIFIED: compiles and its pure part is unit-tested (SilentPushTest); never run on a device or against FCM.
 */
class LottiesMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        if (!SilentPushMessage.isSync(message.data)) return
        val outcome = SilentPushRelay.shared.deliver(ANSWER_WITHIN_MS)
        if (outcome != PingOutcome.NO_APP) {
            runBlocking { withTimeoutOrNull(RENDER_WITHIN_MS) { WidgetRefresher.awaitPending() } }
        }
        Log.i(TAG, "Widget ping: $outcome")
    }

    /**
     * Nothing kept here: the web app asks for the current token at every launch and resume while a widget is installed
     * (`LottiesShared.pushToken`) and registers it with the API, which replaces the old one (design 37b section 5.1).
     */
    override fun onNewToken(token: String) = Unit

    private companion object {
        const val TAG = "LottiesPush"
        const val ANSWER_WITHIN_MS = 15_000L
        const val RENDER_WITHIN_MS = 3_000L
    }
}
