package app.lotties.app.voice

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class McpWireTest {

    private val connection = VoiceConnection(
        authority = "https://auth.test/realms/lotties.app",
        clientId = "lotties-android",
        mcpUrl = "https://lotties.test/api/v1/mcp",
        tokenEndpoint = "https://auth.test/realms/lotties.app/protocol/openid-connect/token",
        accessToken = "access-1",
        refreshToken = "refresh-1",
        expiresAtMillis = 1_000_000L,
    )

    @Test
    fun base64UrlMatchesRfc4648WithoutPadding() {
        assertEquals("", McpWire.base64Url(ByteArray(0)))
        assertEquals("Zg", McpWire.base64Url("f".toByteArray()))
        assertEquals("Zm8", McpWire.base64Url("fo".toByteArray()))
        assertEquals("Zm9v", McpWire.base64Url("foo".toByteArray()))
        assertEquals("Zm9vYmFy", McpWire.base64Url("foobar".toByteArray()))
        assertEquals("-_8", McpWire.base64Url(byteArrayOf(0xfb.toByte(), 0xff.toByte())))
    }

    @Test
    fun challengeIsTheRfc7636Example() {
        // RFC 7636 appendix B.
        assertEquals(
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
            McpWire.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        )
    }

    @Test
    fun randomTokenOf48BytesHas64UrlSafeCharacters() {
        val token = McpWire.randomToken(ByteArray(48) { it.toByte() })
        assertEquals(64, token.length)
        assertTrue(token.all { it.isLetterOrDigit() || it == '-' || it == '_' })
    }

    @Test
    fun authorizeUrlCarriesPkceScopesAndRedirect() {
        val url = McpWire.authorizeUrl("https://auth.test/auth", "lotties-android", "CHAL", "STATE")
        val params = McpWire.queryParams(url)
        assertTrue(url.startsWith("https://auth.test/auth?"))
        assertEquals("code", params["response_type"])
        assertEquals("lotties-android", params["client_id"])
        assertEquals("app.lotties.app://siri/callback", params["redirect_uri"])
        assertEquals("openid offline_access lotties.read lotties.write", params["scope"])
        assertEquals("CHAL", params["code_challenge"])
        assertEquals("S256", params["code_challenge_method"])
        assertEquals("STATE", params["state"])
        assertTrue(url.contains("scope=openid%20offline_access%20lotties.read%20lotties.write"))
        assertTrue(McpWire.authorizeUrl("https://auth.test/auth?kc=1", "c", "x", "y").contains("?kc=1&response_type="))
    }

    @Test
    fun callbackNeedsTheSameState() {
        val url = "app.lotties.app://siri/callback?state=S1&session_state=x&code=abc%2F1"
        assertTrue(McpWire.isCallback(url))
        assertEquals("abc/1", McpWire.codeFrom(url, "S1"))
        assertNull(McpWire.codeFrom(url, "other"))
        assertNull(McpWire.codeFrom("app.lotties.app://siri/callback?state=S1&error=access_denied", "S1"))
        assertFalse(McpWire.isCallback("app.lotties.app://auth/callback?code=1"))
        assertFalse(McpWire.isCallback(McpWire.SETTINGS_URL))
        assertFalse(McpWire.isCallback(null))
    }

    @Test
    fun discoveryAndTokens() {
        val endpoints = McpWire.parseDiscovery("""{"authorization_endpoint":"https://a/auth","token_endpoint":"https://a/token"}""")
        assertEquals(OidcEndpoints("https://a/auth", "https://a/token"), endpoints)
        assertNull(McpWire.parseDiscovery("""{"token_endpoint":"https://a/token"}"""))
        assertNull(McpWire.parseDiscovery("<html>"))
        assertEquals(McpWire.discoveryUrl("https://auth.test/realms/x/"), "https://auth.test/realms/x/.well-known/openid-configuration")

        assertEquals(McpTokens("a", "r", 300), McpWire.parseTokens("""{"access_token":"a","refresh_token":"r","expires_in":300}"""))
        assertEquals(McpTokens("a", null, 300), McpWire.parseTokens("""{"access_token":"a"}"""))
        assertEquals(60L, McpWire.parseTokens("""{"access_token":"a","expires_in":60}""")!!.expiresInSeconds)
        assertNull(McpWire.parseTokens("""{"error":"invalid_grant"}"""))
    }

    @Test
    fun codeExchangeAndRefreshForms() {
        val exchange = McpWire.codeExchange("https://a/token", "lotties-android", "c 1", "v")
        assertEquals("https://a/token", exchange.url)
        assertEquals("application/x-www-form-urlencoded", exchange.headers["Content-Type"])
        assertEquals(
            "grant_type=authorization_code&code=c%201&client_id=lotties-android&redirect_uri=app.lotties.app%3A%2F%2Fsiri%2Fcallback&code_verifier=v",
            exchange.body,
        )
        assertEquals(
            "grant_type=refresh_token&refresh_token=refresh-1&client_id=lotties-android",
            McpWire.refresh(connection).body,
        )
    }

    @Test
    fun toolCallIsOneJsonRpcPostWithTheAndroidHeaders() {
        val request = McpWire.toolCall(connection, "log_tummy_time", mapOf("minutes" to 15, "idempotencyKey" to "k"), "pt-BR")
        assertEquals("https://lotties.test/api/v1/mcp", request.url)
        assertEquals("Bearer access-1", request.headers["Authorization"])
        assertEquals("application/json", request.headers["Content-Type"])
        assertEquals("application/json, text/event-stream", request.headers["Accept"])
        assertEquals("2025-11-25", request.headers["MCP-Protocol-Version"])
        assertEquals("pt-BR", request.headers["Lotties-Speech-Locale"])
        assertEquals("android", request.headers["Lotties-Client"])
        val body = JSONObject(request.body)
        assertEquals("2.0", body.getString("jsonrpc"))
        assertEquals("tools/call", body.getString("method"))
        val params = body.getJSONObject("params")
        assertEquals("log_tummy_time", params.getString("name"))
        assertEquals(15, params.getJSONObject("arguments").getInt("minutes"))
        assertEquals("k", params.getJSONObject("arguments").getString("idempotencyKey"))
    }

    @Test
    fun toolResultFromJsonOrEventStream() {
        val json = """{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{}"}],"structuredContent":{"speech":"Fralda registrada."},"isError":false}}"""
        assertEquals(McpAnswer("Fralda registrada.", false), McpWire.parseToolResult(json, "application/json"))

        val stream = "event: message\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"No baby\"}],\"isError\":true}}\r\n\r\n"
        assertEquals(McpAnswer("No baby", true), McpWire.parseToolResult(stream, "text/event-stream"))

        assertNull(McpWire.parseToolResult("""{"jsonrpc":"2.0","id":1,"error":{"code":-32602}}""", "application/json"))
        assertNull(McpWire.parseToolResult("event: ping\n", "text/event-stream"))
        assertEquals(McpAnswer(null, false), McpWire.parseToolResult("""{"result":{}}""", "application/json"))
    }

    @Test
    fun speechLocaleFollowsTheAppLanguageThenThePhone() {
        assertEquals("pt-BR", McpWire.speechLocale("pt-BR", "en-US"))
        assertEquals("en-US", McpWire.speechLocale("en", "pt-BR"))
        assertEquals("pt-BR", McpWire.speechLocale(null, "pt-PT"))
        assertEquals("en-US", McpWire.speechLocale("", "de-DE"))
        assertEquals("pt-BR", McpWire.snapshotLanguage("""{"version":1,"language":"pt-BR"}"""))
        assertNull(McpWire.snapshotLanguage("""{"version":1}"""))
        assertNull(McpWire.snapshotLanguage("broken"))
        assertNull(McpWire.snapshotLanguage(null))
    }

    @Test
    fun connectionRoundTripsAndRefreshesAMinuteEarly() {
        assertEquals(connection, VoiceConnection.fromJson(connection.toJson()))
        assertNull(VoiceConnection.fromJson("{}"))
        assertNull(VoiceConnection.fromJson(null))
        assertFalse(connection.needsRefresh(1_000_000L - 61_000L))
        assertTrue(connection.needsRefresh(1_000_000L - 59_000L))
        assertTrue(connection.needsRefresh(2_000_000L))

        val rotated = connection.refreshed(McpTokens("access-2", "refresh-2", 300), 5_000L)
        assertEquals("access-2", rotated.accessToken)
        assertEquals("refresh-2", rotated.refreshToken)
        assertEquals(305_000L, rotated.expiresAtMillis)
        assertEquals("refresh-1", connection.refreshed(McpTokens("access-2", null, 300), 0L).refreshToken)
    }
}
