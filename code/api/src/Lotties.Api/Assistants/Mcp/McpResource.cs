using System.Text.Json.Serialization;
using Lotties.Api.Endpoints;

namespace Lotties.Api.Assistants.Mcp;

/// <summary>
/// OAuth 2.0 Protected Resource Metadata (RFC 9728) of the MCP server: where its authorization server is (the OIDC
/// authority, the realm's issuer) and which scopes it knows.
/// </summary>
public sealed record McpProtectedResourceMetadata(
    [property: JsonPropertyName("resource")] string Resource,
    [property: JsonPropertyName("authorization_servers")] IReadOnlyList<string> AuthorizationServers,
    [property: JsonPropertyName("scopes_supported")] IReadOnlyList<string> ScopesSupported,
    [property: JsonPropertyName("bearer_methods_supported")] IReadOnlyList<string> BearerMethodsSupported,
    [property: JsonPropertyName("resource_name")] string ResourceName);

/// <summary>
/// The MCP server as an OAuth protected resource (MCP Authorization, revision 2026-07-28; RFC 9728, RFC 6750): its
/// canonical URL, the metadata URL (the RFC 9728 well-known URI with the endpoint's path appended) and the
/// <c>WWW-Authenticate</c> challenges.
/// </summary>
public static class McpResource
{
    /// <summary>The endpoint's path: Streamable HTTP, one URL for every message.</summary>
    public const string Path = ApiEndpoints.V1Prefix + "/mcp";

    /// <summary>The RFC 9728 well-known prefix; the endpoint's own document is at this prefix followed by <see cref="Path"/>.</summary>
    public const string MetadataPrefix = "/.well-known/oauth-protected-resource";

    /// <summary>The scope a client is told to ask for first (read only; logging is opted into, docs/MCP.md).</summary>
    public const string ChallengeScope = McpScopes.Read;

    /// <summary>The canonical URL of the MCP server: <see cref="McpOptions.ResourceUrl"/>, else the request's scheme and host plus <see cref="Path"/>.</summary>
    public static string UrlOf(HttpRequest request, McpOptions options)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(options);
        return string.IsNullOrWhiteSpace(options.ResourceUrl)
            ? $"{request.Scheme}://{request.Host.Value}{request.PathBase.Value}{Path}"
            : options.ResourceUrl.Trim().TrimEnd('/');
    }

    /// <summary>The metadata URL of <paramref name="resourceUrl"/>: <c>https://host/.well-known/oauth-protected-resource/api/v1/mcp</c>.</summary>
    public static string MetadataUrlOf(string resourceUrl)
    {
        var resource = new Uri(resourceUrl, UriKind.Absolute);
        return $"{resource.Scheme}://{resource.Authority}{MetadataPrefix}{resource.AbsolutePath.TrimEnd('/')}";
    }

    /// <summary>Whether <paramref name="value"/> is an absolute http(s) URL with no query and no fragment.</summary>
    public static bool IsCanonicalUrl(string value) =>
        Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
        && uri.Query.Length == 0
        && uri.Fragment.Length == 0;

    /// <summary>The metadata document of the resource at <paramref name="resourceUrl"/>, naming <paramref name="authorizationServer"/>.</summary>
    public static McpProtectedResourceMetadata MetadataOf(string resourceUrl, string authorizationServer) =>
        new(resourceUrl, [authorizationServer.Trim().TrimEnd('/')], McpScopes.All, ["header"], "Lotties");

    /// <summary>
    /// The 401 challenge: <c>Bearer resource_metadata="...", scope="lotties.read"</c>, plus <c>error="invalid_token"</c> when a
    /// token was sent and failed validation (RFC 6750 section 3.1).
    /// </summary>
    public static string UnauthorizedChallenge(string metadataUrl, bool invalidToken) =>
        invalidToken
            ? $"Bearer error=\"invalid_token\", resource_metadata=\"{metadataUrl}\", scope=\"{ChallengeScope}\""
            : $"Bearer resource_metadata=\"{metadataUrl}\", scope=\"{ChallengeScope}\"";

    /// <summary>The 403 challenge for a token without <paramref name="scopes"/> (MCP scope challenge, RFC 6750 <c>insufficient_scope</c>).</summary>
    public static string InsufficientScopeChallenge(string metadataUrl, IEnumerable<string> scopes) =>
        $"Bearer error=\"insufficient_scope\", scope=\"{string.Join(' ', scopes)}\", resource_metadata=\"{metadataUrl}\", error_description=\"The access token does not grant this Lotties scope.\"";
}
