package app.lotties.app.voice

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.net.URLDecoder
import java.net.URLEncoder
import java.security.MessageDigest

/*
 * The pure half of the Android voice client (docs/design/37-widgets-siri.md section 14), the same wire as the iOS
 * code/mobile/ios/App/App/LottiesMcp.swift: PKCE, the authorize URL, the token and tool-call requests, and the parsing
 * of their answers. No Android API here, so all of it runs in plain JVM unit tests (app/src/test/.../voice).
 */

/** The sign-in this phone keeps (encrypted with the Android Keystore, [VoiceTokenStore]); never in the widget files. */
data class VoiceConnection(
    val authority: String,
    val clientId: String,
    val mcpUrl: String,
    val tokenEndpoint: String,
    val accessToken: String,
    val refreshToken: String,
    val expiresAtMillis: Long,
) {
    /** Refresh first when less than a minute is left (same margin as iOS). */
    fun needsRefresh(nowMillis: Long): Boolean = expiresAtMillis - nowMillis < REFRESH_MARGIN_MS

    fun toJson(): String = JSONObject()
        .put("authority", authority)
        .put("clientId", clientId)
        .put("mcpUrl", mcpUrl)
        .put("tokenEndpoint", tokenEndpoint)
        .put("accessToken", accessToken)
        .put("refreshToken", refreshToken)
        .put("expiresAt", expiresAtMillis)
        .toString()

    /** The connection after a refresh: a new access token, the new refresh token when the server rotated it. */
    fun refreshed(tokens: McpTokens, nowMillis: Long): VoiceConnection = copy(
        accessToken = tokens.access,
        refreshToken = tokens.refresh ?: refreshToken,
        expiresAtMillis = nowMillis + tokens.expiresInSeconds * 1000,
    )

    companion object {
        const val REFRESH_MARGIN_MS = 60_000L

        /** Null for a missing or broken text (the caller then counts the phone as not connected). */
        fun fromJson(text: String?): VoiceConnection? {
            if (text.isNullOrBlank()) return null
            return try {
                val o = JSONObject(text)
                VoiceConnection(
                    authority = o.getString("authority"),
                    clientId = o.getString("clientId"),
                    mcpUrl = o.getString("mcpUrl"),
                    tokenEndpoint = o.getString("tokenEndpoint"),
                    accessToken = o.getString("accessToken"),
                    refreshToken = o.getString("refreshToken"),
                    expiresAtMillis = o.getLong("expiresAt"),
                )
            } catch (_: JSONException) {
                null
            }
        }
    }
}

data class McpTokens(val access: String, val refresh: String?, val expiresInSeconds: Long)

/** What a tool call came back with: the sentence to say (the server's `structuredContent.speech`) and the error flag. */
data class McpAnswer(val speech: String?, val isError: Boolean)

/** The endpoints of the OIDC discovery document the sign-in needs. */
data class OidcEndpoints(val authorization: String, val token: String)

/** One HTTP request, built here and sent by [VoiceMcpClient]. */
data class WireRequest(val url: String, val headers: Map<String, String>, val body: String)

object McpWire {
    const val REDIRECT_URI = "app.lotties.app://siri/callback"
    const val REDIRECT_SCHEME = "app.lotties.app"
    const val REDIRECT_HOST = "siri"
    const val PROTOCOL_VERSION = "2025-11-25"
    /** Marks what Android voice logs as its own (server adapter `android`, docs/design/32-assistants.md 5.2). */
    const val CLIENT_HEADER_VALUE = "android"
    const val SCOPE = "openid offline_access lotties.read lotties.write"
    const val DEFAULT_EXPIRES_IN_SECONDS = 300L

    // PKCE

    /** A verifier or state from random bytes: base64url without padding (48 bytes give 64 characters). */
    fun randomToken(bytes: ByteArray): String = base64Url(bytes)

    /** S256: base64url(SHA-256(verifier)). */
    fun challenge(verifier: String): String =
        base64Url(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))

    /** RFC 4648 section 5, no padding. Written here because java.util.Base64 needs API 26 (minSdk is 24). */
    fun base64Url(bytes: ByteArray): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val out = StringBuilder((bytes.size * 4 + 2) / 3)
        var i = 0
        while (i + 2 < bytes.size) {
            val n = (bytes[i].toInt() and 0xff shl 16) or (bytes[i + 1].toInt() and 0xff shl 8) or (bytes[i + 2].toInt() and 0xff)
            out.append(alphabet[n shr 18 and 63]).append(alphabet[n shr 12 and 63]).append(alphabet[n shr 6 and 63]).append(alphabet[n and 63])
            i += 3
        }
        val rest = bytes.size - i
        if (rest == 1) {
            val n = bytes[i].toInt() and 0xff shl 16
            out.append(alphabet[n shr 18 and 63]).append(alphabet[n shr 12 and 63])
        } else if (rest == 2) {
            val n = (bytes[i].toInt() and 0xff shl 16) or (bytes[i + 1].toInt() and 0xff shl 8)
            out.append(alphabet[n shr 18 and 63]).append(alphabet[n shr 12 and 63]).append(alphabet[n shr 6 and 63])
        }
        return out.toString()
    }

    // Sign-in

    fun discoveryUrl(authority: String): String = authority.trim().trimEnd('/') + "/.well-known/openid-configuration"

    fun parseDiscovery(body: String): OidcEndpoints? = try {
        val o = JSONObject(body)
        val authorization = o.optString("authorization_endpoint")
        val token = o.optString("token_endpoint")
        if (authorization.isEmpty() || token.isEmpty()) null else OidcEndpoints(authorization, token)
    } catch (_: JSONException) {
        null
    }

    fun authorizeUrl(endpoint: String, clientId: String, challenge: String, state: String): String {
        val query = formEncode(
            linkedMapOf(
                "response_type" to "code",
                "client_id" to clientId,
                "redirect_uri" to REDIRECT_URI,
                "scope" to SCOPE,
                "code_challenge" to challenge,
                "code_challenge_method" to "S256",
                "state" to state,
            ),
        )
        return endpoint + (if (endpoint.contains('?')) "&" else "?") + query
    }

    /** The link a voice shortcut opens the app with when the phone is not connected (web: platform/voiceSettingsLink.ts). */
    const val SETTINGS_URL = "app.lotties.app://siri/settings"

    /** True for the redirect of this sign-in, `app.lotties.app://siri/callback?...` (the app's own is `://auth/...`). */
    fun isCallback(url: String?): Boolean =
        url != null && url.substringBefore('?').substringBefore('#') == REDIRECT_URI

    /** The `code` of the redirect when its `state` is the one sent, else null (a foreign or replayed redirect). */
    fun codeFrom(callbackUrl: String, expectedState: String): String? {
        val params = queryParams(callbackUrl)
        if (params["state"] != expectedState) return null
        return params["code"]?.takeIf { it.isNotEmpty() }
    }

    fun queryParams(url: String): Map<String, String> {
        val query = url.substringAfter('?', "").substringBefore('#')
        if (query.isEmpty()) return emptyMap()
        val result = LinkedHashMap<String, String>()
        for (pair in query.split('&')) {
            if (pair.isEmpty()) continue
            val key = decode(pair.substringBefore('='))
            if (!result.containsKey(key)) result[key] = decode(pair.substringAfter('=', ""))
        }
        return result
    }

    fun codeExchange(tokenEndpoint: String, clientId: String, code: String, verifier: String): WireRequest = tokenRequest(
        tokenEndpoint,
        linkedMapOf(
            "grant_type" to "authorization_code",
            "code" to code,
            "client_id" to clientId,
            "redirect_uri" to REDIRECT_URI,
            "code_verifier" to verifier,
        ),
    )

    fun refresh(connection: VoiceConnection): WireRequest = tokenRequest(
        connection.tokenEndpoint,
        linkedMapOf(
            "grant_type" to "refresh_token",
            "refresh_token" to connection.refreshToken,
            "client_id" to connection.clientId,
        ),
    )

    private fun tokenRequest(endpoint: String, form: Map<String, String>) =
        WireRequest(endpoint, mapOf("Content-Type" to "application/x-www-form-urlencoded"), formEncode(form))

    /** The token answer, or null when `access_token` is missing. `expires_in` defaults to 300 s like iOS. */
    fun parseTokens(body: String): McpTokens? = try {
        val o = JSONObject(body)
        val access = o.optString("access_token")
        if (access.isEmpty()) {
            null
        } else {
            val refresh = o.optString("refresh_token").takeIf { it.isNotEmpty() }
            val expires = if (o.has("expires_in")) o.optLong("expires_in", DEFAULT_EXPIRES_IN_SECONDS) else DEFAULT_EXPIRES_IN_SECONDS
            McpTokens(access, refresh, if (expires > 0) expires else DEFAULT_EXPIRES_IN_SECONDS)
        }
    } catch (_: JSONException) {
        null
    }

    // Tool calls

    /** One JSON-RPC `tools/call` POST, no `initialize` (the server answers a lone call; same as iOS). */
    fun toolCall(connection: VoiceConnection, tool: String, arguments: Map<String, Any>, speechLocale: String): WireRequest {
        val args = JSONObject()
        for ((key, value) in arguments) args.put(key, value)
        val body = JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", 1)
            .put("method", "tools/call")
            .put("params", JSONObject().put("name", tool).put("arguments", args))
        val headers = linkedMapOf(
            "Authorization" to "Bearer ${connection.accessToken}",
            "Content-Type" to "application/json",
            "Accept" to "application/json, text/event-stream",
            "MCP-Protocol-Version" to PROTOCOL_VERSION,
            "Lotties-Speech-Locale" to speechLocale,
            "Lotties-Client" to CLIENT_HEADER_VALUE,
        )
        return WireRequest(connection.mcpUrl, headers, body.toString())
    }

    /** The JSON-RPC `result` as an answer, from a plain JSON body or the last `data:` line of an event stream. */
    fun parseToolResult(body: String, contentType: String): McpAnswer? {
        var payload = body
        if (contentType.contains("event-stream")) {
            val last = body.split('\n').map { it.trimEnd('\r') }.lastOrNull { it.startsWith("data:") } ?: return null
            payload = last.removePrefix("data:").trim()
        }
        return try {
            val result = JSONObject(payload).optJSONObject("result") ?: return null
            val speech = result.optJSONObject("structuredContent")?.optString("speech")?.takeIf { it.isNotEmpty() }
                ?: firstText(result.optJSONArray("content"))
            McpAnswer(speech, result.optBoolean("isError", false))
        } catch (_: JSONException) {
            null
        }
    }

    private fun firstText(content: JSONArray?): String? {
        if (content == null) return null
        for (i in 0 until content.length()) {
            val text = content.optJSONObject(i)?.optString("text")
            if (!text.isNullOrEmpty()) return text
        }
        return null
    }

    /**
     * The server's speech locale: the app's language (the web app writes it in the widget snapshot) when known, else the
     * phone's. Only the two the server renders: "pt-BR" and "en-US".
     */
    fun speechLocale(appLanguage: String?, phoneLanguage: String): String {
        val language = appLanguage?.takeIf { it.isNotBlank() } ?: phoneLanguage
        return if (language.lowercase().startsWith("pt")) "pt-BR" else "en-US"
    }

    /** The `language` member of the widget snapshot (docs/design/37 section 2.1), or null. */
    fun snapshotLanguage(snapshot: String?): String? {
        if (snapshot.isNullOrBlank()) return null
        return try {
            JSONObject(snapshot).optString("language").takeIf { it.isNotEmpty() }
        } catch (_: JSONException) {
            null
        }
    }

    fun formEncode(form: Map<String, String>): String =
        form.entries.joinToString("&") { (key, value) -> "${encode(key)}=${encode(value)}" }

    /** Percent-encoding with only `A-Z a-z 0-9 - . _ ~` left as is (spaces become %20, like iOS). */
    fun encode(value: String): String =
        URLEncoder.encode(value, "UTF-8").replace("+", "%20").replace("*", "%2A").replace("%7E", "~")

    private fun decode(value: String): String = try {
        URLDecoder.decode(value, "UTF-8")
    } catch (_: IllegalArgumentException) {
        value
    }
}
