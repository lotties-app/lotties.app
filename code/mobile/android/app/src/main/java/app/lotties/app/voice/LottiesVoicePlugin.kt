package app.lotties.app.voice

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Capacitor plugin `LottiesVoice` (code/web/src/assistants/androidVoiceBridge.ts), the Android side of the iOS
 * `siriStatus` / `siriConnect` / `siriDisconnect` messages (LottiesBridgeViewController.swift): Settings > Voice
 * assistants > Voice on Android signs the phone's voice shortcuts in to the MCP server (PKCE, public client
 * `lotties-android`, redirect `app.lotties.app://siri/callback` caught by MainActivity's intent filter and handed here
 * through [handleOnNewIntent]). Answers `{connected: boolean}`; a cancelled sign-in resolves `connected: false`.
 */
@CapacitorPlugin(name = "LottiesVoice")
class LottiesVoicePlugin : Plugin() {

    private class Pending(
        val call: PluginCall,
        val authority: String,
        val clientId: String,
        val mcpUrl: String,
        val tokenEndpoint: String,
        val verifier: String,
        val state: String,
    )

    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val random = SecureRandom()
    private var pending: Pending? = null
    private var browserOpen = false

    @PluginMethod
    fun status(call: PluginCall) {
        worker.execute { call.resolve(answer(VoiceTokenStore.isConnected(context))) }
    }

    @PluginMethod
    fun connect(call: PluginCall) {
        val authority = call.getString("authority")
        val clientId = call.getString("clientId")
        val mcpUrl = call.getString("mcpUrl")
        if (authority.isNullOrBlank() || clientId.isNullOrBlank() || mcpUrl.isNullOrBlank()) {
            call.reject("authority, clientId and mcpUrl are required")
            return
        }
        worker.execute {
            try {
                val endpoints = VoiceMcpClient.discover(authority)
                val verifier = McpWire.randomToken(bytes(48))
                val state = McpWire.randomToken(bytes(16))
                val url = McpWire.authorizeUrl(endpoints.authorization, clientId, McpWire.challenge(verifier), state)
                main.post { open(Pending(call, authority, clientId, mcpUrl, endpoints.token, verifier, state), url) }
            } catch (error: Exception) {
                call.reject("Voice sign-in failed (${error.message})")
            }
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        worker.execute {
            VoiceTokenStore.clear(context)
            call.resolve(answer(false))
        }
    }

    /** The system browser, as a Custom Tab where the browser supports it (the extra alone asks for one; no library). */
    private fun open(next: Pending, url: String) {
        pending?.call?.resolve(answer(false)) // a second Connect replaces the first
        pending = next
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        intent.putExtras(Bundle().apply { putBinder(CUSTOM_TABS_SESSION, null) })
        try {
            activity.startActivity(intent)
            browserOpen = true
        } catch (error: ActivityNotFoundException) {
            pending = null
            next.call.reject("No browser to sign in with", error)
        }
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        val url = intent.dataString
        if (!McpWire.isCallback(url)) return
        val flow = pending ?: return // a redirect nobody waits for (process restarted, replay): ignored
        pending = null
        browserOpen = false
        val code = McpWire.codeFrom(url!!, flow.state)
        if (code == null) {
            // Denied consent or a foreign state: not connected, nothing stored.
            flow.call.resolve(answer(false))
            return
        }
        worker.execute {
            try {
                VoiceMcpClient.exchange(context, flow.authority, flow.clientId, flow.mcpUrl, flow.tokenEndpoint, code, flow.verifier)
                flow.call.resolve(answer(true))
            } catch (error: Exception) {
                flow.call.reject("Voice sign-in failed (${error.message})")
            }
        }
    }

    /** Back in the app without a redirect: the person closed the browser, the sign-in is cancelled. */
    override fun handleOnResume() {
        super.handleOnResume()
        if (!browserOpen) return
        main.postDelayed({
            val flow = pending
            if (flow != null && browserOpen) {
                pending = null
                browserOpen = false
                flow.call.resolve(answer(false))
            }
        }, CANCEL_DELAY_MS)
    }

    override fun handleOnDestroy() {
        worker.shutdown()
        super.handleOnDestroy()
    }

    private fun bytes(count: Int) = ByteArray(count).also { random.nextBytes(it) }

    private fun answer(connected: Boolean) = JSObject().put("connected", connected)

    private companion object {
        const val CUSTOM_TABS_SESSION = "android.support.customtabs.extra.SESSION"
        const val CANCEL_DELAY_MS = 1500L
    }
}
