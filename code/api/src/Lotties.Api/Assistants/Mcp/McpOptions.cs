using Lotties.Api.Authentication;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Assistants.Mcp;

/// <summary>
/// The MCP server (section <c>Mcp</c>, env e.g. <c>Mcp__Enabled</c>, <c>Mcp__Audience</c>; docs/MCP.md): off by default, when
/// every MCP route (the endpoint and the protected resource metadata) answers 404. No secret lives here: the AI clients
/// are Keycloak's (their own public clients or registrations), and the API only validates the tokens they bring.
/// </summary>
public sealed class McpOptions
{
    public const string SectionName = "Mcp";

    /// <summary>The audience every MCP access token must carry: Keycloak's audience mapper on the <c>lotties.*</c> client scopes.</summary>
    public const string DefaultAudience = "lotties-mcp";

    public bool Enabled { get; set; }

    /// <summary>
    /// The <c>aud</c> MCP tokens must carry (default <see cref="DefaultAudience"/>). It must differ from the API's own audience
    /// (<c>AUTH_AUDIENCE</c>): the web app's tokens never work here, and the tokens an AI provider holds never work on the REST API.
    /// </summary>
    public string Audience { get; set; } = DefaultAudience;

    /// <summary>
    /// The MCP server's canonical URL (the RFC 8707 resource, e.g. <c>https://lotties.app/api/v1/mcp</c>); empty derives it from
    /// the request (scheme and host after the trusted proxy headers).
    /// </summary>
    public string? ResourceUrl { get; set; }

    /// <summary>
    /// Browser origins allowed to call the endpoint (list or one comma-separated value). A request with any other
    /// <c>Origin</c> is 403 (DNS rebinding protection, MCP Streamable HTTP); requests without <c>Origin</c> (server-side MCP
    /// clients such as Claude's connectors) are not affected. Empty (the default) allows no browser origin.
    /// </summary>
    public List<string> AllowedOrigins { get; set; } = [];

    /// <summary>Largest request body (a JSON-RPC message is a few hundred bytes); default 64 KiB, larger is 413.</summary>
    public int MaxRequestBodyBytes { get; set; } = 64 * 1024;

    /// <summary>Whether <paramref name="origin"/> is one of <see cref="AllowedOrigins"/> (scheme and host ignoring case, no trailing slash).</summary>
    public bool AllowsOrigin(string origin) =>
        AllowedOrigins.Any(allowed => string.Equals(allowed.Trim().TrimEnd('/'), origin.Trim().TrimEnd('/'), StringComparison.OrdinalIgnoreCase));
}

/// <summary>Fails startup when the MCP settings are unusable: no OIDC authority, a blank or shared audience, a bad URL or limit.</summary>
internal sealed class McpOptionsValidator(IOptions<AuthOptions> auth) : IValidateOptions<McpOptions>
{
    public ValidateOptionsResult Validate(string? name, McpOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = CollectFailures(options).ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private IEnumerable<string> CollectFailures(McpOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.Audience))
        {
            yield return "Mcp:Audience must not be empty.";
        }
        else if (string.Equals(options.Audience.Trim(), auth.Value.Audience?.Trim(), StringComparison.Ordinal))
        {
            yield return "Mcp:Audience must differ from Auth:Audience (AUTH_AUDIENCE): MCP tokens and the web app's tokens must not work in each other's place.";
        }

        if (options.Enabled && string.IsNullOrWhiteSpace(auth.Value.Authority))
        {
            yield return "Mcp:Enabled needs Auth:Authority (AUTH_AUTHORITY): it is the authorization server the MCP clients are sent to.";
        }

        if (!string.IsNullOrWhiteSpace(options.ResourceUrl) && !McpResource.IsCanonicalUrl(options.ResourceUrl))
        {
            yield return "Mcp:ResourceUrl must be an absolute http(s) URL without query or fragment, e.g. https://lotties.app/api/v1/mcp.";
        }

        foreach (var origin in options.AllowedOrigins.Where(origin => !Uri.TryCreate(origin.Trim(), UriKind.Absolute, out _)))
        {
            yield return $"Mcp:AllowedOrigins has a value that is not an absolute origin: '{origin}'.";
        }

        if (options.MaxRequestBodyBytes is < 1024 or > 1024 * 1024)
        {
            yield return "Mcp:MaxRequestBodyBytes must be between 1024 and 1048576.";
        }
    }
}

/// <summary>Adds a comma-separated <c>Mcp:AllowedOrigins</c> value (one env variable) to the bound list.</summary>
internal sealed class McpAllowedOriginsFromText(IConfiguration configuration) : IPostConfigureOptions<McpOptions>
{
    public void PostConfigure(string? name, McpOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var text = configuration.GetSection(McpOptions.SectionName)[nameof(McpOptions.AllowedOrigins)];
        var fromText = (text ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        options.AllowedOrigins = options.AllowedOrigins.Select(origin => origin.Trim()).Concat(fromText).Where(origin => origin.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }
}
