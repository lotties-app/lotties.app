import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

/*
 * Siri and Shortcuts talk to the same MCP server the AI assistants use (docs/design/37-widgets-siri.md section 8,
 * docs/design/32-assistants.md section 9): one `tools/call` per spoken request, answered by the server with the sentence
 * the Alexa skill would say (header `Lotties-Speech-Locale`). The sign-in is its own OAuth client (PKCE, no secret) whose
 * tokens carry the MCP audience; they live in the Keychain, never in the App Group files the widget reads. App target only.
 */

struct McpConnection: Codable {
    var authority: String
    var clientId: String
    var mcpUrl: String
    var tokenEndpoint: String
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
}

enum McpKeychain {
    private static let service = "app.lotties.app.mcp"
    private static let account = "connection"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func load() -> McpConnection? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? LottiesShared.decoder.decode(McpConnection.self, from: data)
    }

    static func save(_ connection: McpConnection) {
        guard let data = try? LottiesShared.encoder.encode(connection) else { return }
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func delete() { SecItemDelete(query as CFDictionary) }
}

/// What a tool call came back with.
struct McpAnswer {
    var speech: String?
    var isError: Bool
}

enum McpFailure: Error {
    case notConnected
    case offline
    case unauthorized
    case server
}

enum LottiesMcp {
    static let redirectUri = "app.lotties.app://siri/callback"
    private static let protocolVersion = "2025-11-25"

    static var isConnected: Bool { McpKeychain.load() != nil }

    /// The app's language as the server's speech locale ("pt-BR", "en-US").
    private static var speechLocale: String { LottiesText.isPortuguese ? "pt-BR" : "en-US" }

    // MARK: Tool calls

    static func call(_ tool: String, _ arguments: [String: Any] = [:]) async throws -> McpAnswer {
        guard var connection = McpKeychain.load() else { throw McpFailure.notConnected }
        if connection.expiresAt.timeIntervalSinceNow < 60 { connection = try await refresh(connection) }
        do {
            return try await post(tool, arguments, connection)
        } catch McpFailure.unauthorized {
            connection = try await refresh(connection)
            return try await post(tool, arguments, connection)
        }
    }

    private static func post(_ tool: String, _ arguments: [String: Any], _ connection: McpConnection) async throws -> McpAnswer {
        guard let url = URL(string: connection.mcpUrl) else { throw McpFailure.server }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("Bearer \(connection.accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json, text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue(protocolVersion, forHTTPHeaderField: "MCP-Protocol-Version")
        request.setValue(speechLocale, forHTTPHeaderField: "Lotties-Speech-Locale")
        let body: [String: Any] = [
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": ["name": tool, "arguments": arguments],
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await send(request)
        switch response.statusCode {
        case 200: break
        case 401: throw McpFailure.unauthorized
        case 403: return McpAnswer(speech: LottiesText.t(
            "O Lotties não permite isso para a sua conta ou para a conexão da Siri.",
            "Lotties does not allow that for your account or the Siri connection."), isError: true)
        default: throw McpFailure.server
        }
        guard let result = rpcResult(data, contentType: response.value(forHTTPHeaderField: "Content-Type") ?? "") else {
            throw McpFailure.server
        }
        let structured = result["structuredContent"] as? [String: Any]
        let texts = (result["content"] as? [[String: Any]])?.compactMap { $0["text"] as? String } ?? []
        return McpAnswer(
            speech: (structured?["speech"] as? String) ?? texts.first,
            isError: result["isError"] as? Bool ?? false)
    }

    /// The JSON-RPC `result`, from a plain JSON body or from the `data:` lines of an event stream.
    private static func rpcResult(_ data: Data, contentType: String) -> [String: Any]? {
        var payload = data
        if contentType.contains("event-stream"), let text = String(data: data, encoding: .utf8) {
            let lines = text.split(separator: "\n").filter { $0.hasPrefix("data:") }
            guard let last = lines.last else { return nil }
            payload = Data(last.dropFirst(5).trimmingCharacters(in: .whitespaces).utf8)
        }
        let object = try? JSONSerialization.jsonObject(with: payload) as? [String: Any]
        return object?["result"] as? [String: Any]
    }

    private static func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw McpFailure.server }
            return (data, http)
        } catch let error as URLError
            where [.notConnectedToInternet, .cannotFindHost, .cannotConnectToHost, .timedOut, .networkConnectionLost,
                   .dataNotAllowed].contains(error.code) {
            throw McpFailure.offline
        }
    }

    // MARK: Tokens

    private static func refresh(_ connection: McpConnection) async throws -> McpConnection {
        let form = ["grant_type": "refresh_token", "refresh_token": connection.refreshToken, "client_id": connection.clientId]
        do {
            let tokens = try await tokenRequest(connection.tokenEndpoint, form)
            var next = connection
            next.accessToken = tokens.access
            next.refreshToken = tokens.refresh ?? connection.refreshToken
            next.expiresAt = Date().addingTimeInterval(tokens.expiresIn)
            McpKeychain.save(next)
            return next
        } catch McpFailure.unauthorized {
            McpKeychain.delete()
            throw McpFailure.notConnected
        }
    }

    private struct Tokens {
        var access: String
        var refresh: String?
        var expiresIn: TimeInterval
    }

    private static func tokenRequest(_ endpoint: String, _ form: [String: String]) async throws -> Tokens {
        guard let url = URL(string: endpoint) else { throw McpFailure.server }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formEncoded(form).data(using: .utf8)
        let (data, response) = try await send(request)
        if response.statusCode == 400 || response.statusCode == 401 { throw McpFailure.unauthorized }
        guard response.statusCode == 200,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = object["access_token"] as? String else { throw McpFailure.server }
        return Tokens(
            access: access, refresh: object["refresh_token"] as? String,
            expiresIn: (object["expires_in"] as? Double) ?? 300)
    }

    private static func formEncoded(_ form: [String: String]) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return form.map { key, value in
            "\(key)=\(value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value)"
        }.joined(separator: "&")
    }

    // MARK: Sign-in (the "Connect Siri" button in Settings > Voice assistants)

    @MainActor
    static func connect(authority: String, clientId: String, mcpUrl: String) async throws {
        guard let configUrl = URL(string: authority.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/.well-known/openid-configuration")
        else { throw McpFailure.server }
        let (data, _) = try await send(URLRequest(url: configUrl, timeoutInterval: 20))
        guard let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let authorizationEndpoint = config["authorization_endpoint"] as? String,
              let tokenEndpoint = config["token_endpoint"] as? String,
              var components = URLComponents(string: authorizationEndpoint) else { throw McpFailure.server }

        let verifier = randomString(48)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        let state = randomString(16)
        components.queryItems = (components.queryItems ?? []) + [
            .init(name: "response_type", value: "code"),
            .init(name: "client_id", value: clientId),
            .init(name: "redirect_uri", value: redirectUri),
            .init(name: "scope", value: "openid offline_access lotties.read lotties.write"),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
        ]
        guard let authorizeUrl = components.url else { throw McpFailure.server }

        let callback = try await WebSignIn.run(url: authorizeUrl, scheme: "app.lotties.app")
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else { throw McpFailure.unauthorized }

        let tokens = try await tokenRequest(tokenEndpoint, [
            "grant_type": "authorization_code", "code": code, "client_id": clientId,
            "redirect_uri": redirectUri, "code_verifier": verifier,
        ])
        guard let refresh = tokens.refresh else { throw McpFailure.server }
        McpKeychain.save(McpConnection(
            authority: authority, clientId: clientId, mcpUrl: mcpUrl, tokenEndpoint: tokenEndpoint,
            accessToken: tokens.access, refreshToken: refresh, expiresAt: Date().addingTimeInterval(tokens.expiresIn)))
    }

    static func disconnect() { McpKeychain.delete() }

    private static func randomString(_ length: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, length, &bytes)
        return Data(bytes).base64URL
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

/// One `ASWebAuthenticationSession` at a time, shown over the app's window.
@MainActor
private final class WebSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private static var current: WebSignIn?

    static func run(url: URL, scheme: String) async throws -> URL {
        let flow = WebSignIn()
        current = flow
        defer { current = nil }
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { callback, error in
                if let callback { continuation.resume(returning: callback) } else { continuation.resume(throwing: error ?? McpFailure.unauthorized) }
            }
            session.presentationContextProvider = flow
            flow.session = session
            if !session.start() { continuation.resume(throwing: McpFailure.server) }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor()
    }
}
