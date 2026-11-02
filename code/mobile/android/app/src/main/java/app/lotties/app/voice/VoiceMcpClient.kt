package app.lotties.app.voice

import android.content.Context
import android.content.res.Resources
import app.lotties.app.shared.LottiesStore
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.UUID

/** Why a voice request did not get an answer (the same cases as iOS `McpFailure`). */
class VoiceFailure(val reason: Reason, cause: Throwable? = null) : Exception(reason.name, cause) {
    enum class Reason { NOT_CONNECTED, OFFLINE, UNAUTHORIZED, FORBIDDEN, SERVER }
}

/** One HTTP answer. */
data class WireResponse(val status: Int, val contentType: String, val body: String)

/**
 * The network half of the voice client: sends what [McpWire] builds over HttpURLConnection (no extra library), refreshes
 * the access token a minute before it expires and once more after a 401, and drops the sign-in when the refresh token is
 * refused (like iOS). Blocking: call it off the main thread.
 */
object VoiceMcpClient {
    private const val TIMEOUT_MS = 20_000

    /** The server's speech locale from the app language the web app put in the widget snapshot, else the phone's. */
    @JvmStatic
    fun speechLocale(context: Context): String {
        val phone = Resources.getSystem().configuration.locales[0]?.toLanguageTag() ?: "en"
        return McpWire.speechLocale(McpWire.snapshotLanguage(LottiesStore.readSnapshot(context)), phone)
    }

    @Throws(VoiceFailure::class)
    fun call(context: Context, call: ToolCall): McpAnswer {
        var connection = VoiceTokenStore.load(context) ?: throw VoiceFailure(VoiceFailure.Reason.NOT_CONNECTED)
        val arguments = if (call.write) call.arguments + ("idempotencyKey" to UUID.randomUUID().toString()) else call.arguments
        val locale = speechLocale(context)
        if (connection.needsRefresh(System.currentTimeMillis())) connection = refresh(context, connection)
        return try {
            post(McpWire.toolCall(connection, call.tool, arguments, locale))
        } catch (failure: VoiceFailure) {
            if (failure.reason != VoiceFailure.Reason.UNAUTHORIZED) throw failure
            connection = refresh(context, connection)
            post(McpWire.toolCall(connection, call.tool, arguments, locale))
        }
    }

    private fun post(request: WireRequest): McpAnswer {
        val response = send(request)
        when (response.status) {
            200 -> Unit
            401 -> throw VoiceFailure(VoiceFailure.Reason.UNAUTHORIZED)
            403 -> throw VoiceFailure(VoiceFailure.Reason.FORBIDDEN)
            else -> throw VoiceFailure(VoiceFailure.Reason.SERVER)
        }
        return McpWire.parseToolResult(response.body, response.contentType) ?: throw VoiceFailure(VoiceFailure.Reason.SERVER)
    }

    private fun refresh(context: Context, connection: VoiceConnection): VoiceConnection {
        val response = send(McpWire.refresh(connection))
        if (response.status == 400 || response.status == 401) {
            VoiceTokenStore.clear(context)
            throw VoiceFailure(VoiceFailure.Reason.NOT_CONNECTED)
        }
        val tokens = (if (response.status == 200) McpWire.parseTokens(response.body) else null)
            ?: throw VoiceFailure(VoiceFailure.Reason.SERVER)
        val next = connection.refreshed(tokens, System.currentTimeMillis())
        save(context, next)
        return next
    }

    // Sign-in steps (LottiesVoicePlugin runs them)

    fun discover(authority: String): OidcEndpoints {
        val response = send(WireRequest(McpWire.discoveryUrl(authority), emptyMap(), ""), method = "GET")
        return (if (response.status == 200) McpWire.parseDiscovery(response.body) else null)
            ?: throw VoiceFailure(VoiceFailure.Reason.SERVER)
    }

    /** Exchanges the code and stores the connection. A token answer without a refresh token is refused (iOS too). */
    fun exchange(
        context: Context,
        authority: String,
        clientId: String,
        mcpUrl: String,
        tokenEndpoint: String,
        code: String,
        verifier: String,
    ) {
        val response = send(McpWire.codeExchange(tokenEndpoint, clientId, code, verifier))
        if (response.status == 400 || response.status == 401) throw VoiceFailure(VoiceFailure.Reason.UNAUTHORIZED)
        val tokens = (if (response.status == 200) McpWire.parseTokens(response.body) else null)
            ?: throw VoiceFailure(VoiceFailure.Reason.SERVER)
        val refresh = tokens.refresh ?: throw VoiceFailure(VoiceFailure.Reason.SERVER)
        save(
            context,
            VoiceConnection(
                authority, clientId, mcpUrl, tokenEndpoint, tokens.access, refresh,
                System.currentTimeMillis() + tokens.expiresInSeconds * 1000,
            ),
        )
    }

    private fun save(context: Context, connection: VoiceConnection) {
        try {
            VoiceTokenStore.save(context, connection)
        } catch (error: Exception) {
            throw VoiceFailure(VoiceFailure.Reason.SERVER, error)
        }
    }

    private fun send(request: WireRequest, method: String = "POST"): WireResponse {
        val http = try {
            URL(request.url).openConnection() as HttpURLConnection
        } catch (error: Exception) {
            throw VoiceFailure(VoiceFailure.Reason.SERVER, error)
        }
        try {
            http.requestMethod = method
            http.connectTimeout = TIMEOUT_MS
            http.readTimeout = TIMEOUT_MS
            http.instanceFollowRedirects = false
            http.useCaches = false
            for ((name, value) in request.headers) http.setRequestProperty(name, value)
            if (method == "POST") {
                http.doOutput = true
                http.outputStream.use { it.write(request.body.toByteArray(Charsets.UTF_8)) }
            }
            val status = http.responseCode
            val stream: InputStream? = if (status >= 400) http.errorStream else http.inputStream
            val body = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            return WireResponse(status, http.contentType ?: "", body)
        } catch (error: UnknownHostException) {
            throw VoiceFailure(VoiceFailure.Reason.OFFLINE, error)
        } catch (error: SocketTimeoutException) {
            throw VoiceFailure(VoiceFailure.Reason.OFFLINE, error)
        } catch (error: java.net.ConnectException) {
            throw VoiceFailure(VoiceFailure.Reason.OFFLINE, error)
        } catch (error: IOException) {
            throw VoiceFailure(VoiceFailure.Reason.OFFLINE, error)
        } finally {
            http.disconnect()
        }
    }
}
