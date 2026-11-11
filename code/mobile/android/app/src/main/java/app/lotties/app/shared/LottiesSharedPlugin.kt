package app.lotties.app.shared

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import app.lotties.app.push.PingReceiver
import app.lotties.app.push.SilentPushMessage
import app.lotties.app.push.SilentPushRelay
import app.lotties.app.voice.VoiceTokenStore
import app.lotties.app.widgets.ActivitiesWidgetReceiver
import app.lotties.app.widgets.LottiesWidgetReceiver
import app.lotties.app.widgets.SummaryWidgetReceiver
import app.lotties.app.widgets.WidgetRefresher
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

/**
 * Capacitor plugin `LottiesShared` (code/web/src/widgets/widgetBridge.ts), same methods and answers as the iOS
 * `LottiesSharedPlugin.swift`: the web app writes the widget snapshot and drains the outbox the widget buttons and
 * voice actions fill. Storage is [LottiesStore]. Registered in `MainActivity`.
 *
 * Also the Android side of the widgets' silent push (code/web/src/widgets/silentPushBridge.ts, the iOS twin is
 * `LottiesSilentPush` in LottiesBridgeViewController.swift; docs/design/37b-widget-silent-push.md section 9):
 * `widgetsInstalled`, `pushToken`, `silentPushDone` and the `remoteChange` event, fired for each ping the messaging
 * service ([app.lotties.app.push.LottiesMessagingService]) receives while this plugin is loaded.
 */
@CapacitorPlugin(name = "LottiesShared")
class LottiesSharedPlugin : Plugin() {

    /** The FCM token request blocks (up to [TOKEN_WITHIN_SECONDS]); every plugin shares Capacitor's one thread. */
    private val worker: ExecutorService = Executors.newSingleThreadExecutor()

    /** Pings go to the page only when it listens (silent push started: signed in, current consent, native app). */
    private val pingReceiver = PingReceiver {
        if (!hasListeners(REMOTE_CHANGE)) return@PingReceiver false
        notifyListeners(REMOTE_CHANGE, JSObject())
        true
    }

    /** The widgets follow every snapshot the web app writes from now on (process-wide listener); pings reach the page. */
    override fun load() {
        WidgetRefresher.register(context)
        SilentPushRelay.shared.attach(pingReceiver)
    }

    override fun handleOnDestroy() {
        SilentPushRelay.shared.detach(pingReceiver)
        worker.shutdown()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun writeSnapshot(call: PluginCall) {
        val json = call.getString("json")
        if (json == null) {
            call.reject("json is required")
            return
        }
        try {
            LottiesStore.writeSnapshot(context, json)
            call.resolve()
        } catch (error: Exception) {
            call.reject("The shared directory is not available", error)
        }
    }

    @PluginMethod
    fun readOutbox(call: PluginCall) {
        call.resolve(JSObject().put("json", LottiesStore.readOutbox(context)))
    }

    @PluginMethod
    fun removeOutbox(call: PluginCall) {
        val array = call.getArray("ids")
        val ids = ArrayList<String>()
        if (array != null) {
            for (index in 0 until array.length()) {
                array.optString(index, null)?.let { ids.add(it) }
            }
        }
        try {
            LottiesStore.removeOutbox(context, ids)
            call.resolve()
        } catch (error: Exception) {
            call.reject("Cannot update the outbox", error)
        }
    }

    /** Sign-out and account erasure (code/web/src/session/endSession.ts): also drops the voice sign-in, like iOS. */
    @PluginMethod
    fun clearAll(call: PluginCall) {
        LottiesStore.clearAll(context)
        VoiceTokenStore.clear(context)
        call.resolve()
    }

    /** What the plugin sees: whether the shared directory exists and how big the two files are (-1: missing). */
    @PluginMethod
    fun diagnose(call: PluginCall) {
        val dir = LottiesStore.directory(context)
        val result = JSObject()
        result.put("container", dir.isDirectory)
        result.put("snapshotBytes", LottiesStore.fileBytes(dir, LottiesStore.SNAPSHOT_FILE))
        result.put("outboxBytes", LottiesStore.fileBytes(dir, LottiesStore.OUTBOX_FILE))
        call.resolve(result)
    }

    /** Whether at least one Lotties widget (any of the three) is on a home or lock screen: `{installed}`. */
    @PluginMethod
    fun widgetsInstalled(call: PluginCall) {
        val installed = try {
            val manager = AppWidgetManager.getInstance(context)
            manager != null && WIDGET_RECEIVERS.any { receiver ->
                manager.getAppWidgetIds(ComponentName(context, receiver)).isNotEmpty()
            }
        } catch (_: RuntimeException) {
            false
        }
        call.resolve(JSObject().put("installed", installed))
    }

    /**
     * This install's FCM registration token: `{channel: "fcm", token}`, or `{}` when the build has no Firebase
     * (no google-services.json), the phone has no Google Play services, or FCM did not answer in time. Never logged.
     * Auto-init is off (AndroidManifest.xml) and stays off: this explicit request is the only way a token is made, and
     * the web app sends it only after the API said silent pushes are on (`GET /push/silent/status`, design 37b section
     * 5.4) and a widget is installed. Turning auto-init on here would make later launches contact FCM by themselves,
     * even after the server switched silent pushes off.
     */
    @PluginMethod
    fun pushToken(call: PluginCall) {
        try {
            worker.execute { call.resolve(tokenReply(fcmToken())) }
        } catch (_: RejectedExecutionException) {
            call.resolve(tokenReply(null)) // the plugin is being destroyed
        }
    }

    private fun fcmToken(): String? = try {
        if (FirebaseApp.getApps(context).isEmpty()) {
            null
        } else {
            Tasks.await(FirebaseMessaging.getInstance().token, TOKEN_WITHIN_SECONDS, TimeUnit.SECONDS)
        }
    } catch (_: Exception) {
        null
    }

    private fun tokenReply(token: String?): JSObject {
        val reply = JSObject()
        SilentPushMessage.tokenReply(token).forEach { (key, value) -> reply.put(key, value) }
        return reply
    }

    /** The page handled a ping (`changed`: its sync succeeded): ends the messaging service's wait. */
    @PluginMethod
    fun silentPushDone(call: PluginCall) {
        SilentPushRelay.shared.answered(call.getBoolean("changed", false) == true)
        call.resolve()
    }

    private companion object {
        const val REMOTE_CHANGE = "remoteChange"
        const val TOKEN_WITHIN_SECONDS = 10L
        val WIDGET_RECEIVERS = listOf(
            SummaryWidgetReceiver::class.java,
            LottiesWidgetReceiver::class.java,
            ActivitiesWidgetReceiver::class.java,
        )
    }
}
