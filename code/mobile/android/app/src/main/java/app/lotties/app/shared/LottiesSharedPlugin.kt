package app.lotties.app.shared

import app.lotties.app.voice.VoiceTokenStore
import app.lotties.app.widgets.WidgetRefresher
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Capacitor plugin `LottiesShared` (code/web/src/widgets/widgetBridge.ts), same methods and answers as the iOS
 * `LottiesSharedPlugin.swift`: the web app writes the widget snapshot and drains the outbox the widget buttons and
 * voice actions fill. Storage is [LottiesStore]. Registered in `MainActivity`.
 */
@CapacitorPlugin(name = "LottiesShared")
class LottiesSharedPlugin : Plugin() {

    /** The widgets follow every snapshot the web app writes from now on (process-wide listener). */
    override fun load() {
        WidgetRefresher.register(context)
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
}
