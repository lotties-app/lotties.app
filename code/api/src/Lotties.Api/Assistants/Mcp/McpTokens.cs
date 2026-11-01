using Lotties.Api.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Assistants.Mcp;

/// <summary>
/// The MCP access tokens: a third JWT bearer scheme, <see cref="SchemeName"/>, configured by the API's own
/// <see cref="ConfigureJwtBearerOptions"/> (issuer from the authority's discovery document, signing keys, lifetime, <c>sub</c>
/// required; nothing copied by hand or weakened) with one difference: the audience is <see cref="McpOptions.Audience"/>
/// (the MCP resource), never the API's. Read from the <c>Authorization</c> header only (never the query string). Its challenge
/// is the MCP one: 401 with <c>WWW-Authenticate: Bearer resource_metadata="...", scope="lotties.read"</c>.
/// </summary>
public static class McpTokens
{
    public const string SchemeName = "Mcp";

    /// <summary>The authorization policy of the MCP endpoint: an authenticated user of <see cref="SchemeName"/> (scopes are checked per message).</summary>
    public const string PolicyName = "McpClient";

    internal static AuthorizationPolicy Policy { get; } = new AuthorizationPolicyBuilder(SchemeName).RequireAuthenticatedUser().Build();
}

/// <summary>Configures <see cref="McpTokens.SchemeName"/> like the API's scheme, with the MCP audience and challenge.</summary>
internal sealed class ConfigureMcpJwtBearerOptions(IOptions<AuthOptions> authOptions, IOptions<McpOptions> mcpOptions) : IConfigureNamedOptions<JwtBearerOptions>
{
    public void Configure(string? name, JwtBearerOptions options)
    {
        if (name != McpTokens.SchemeName)
        {
            return;
        }

        new ConfigureJwtBearerOptions(authOptions).Configure(options);
        options.Audience = mcpOptions.Value.Audience.Trim();
        options.Events.OnChallenge = ChallengeAsync;
    }

    public void Configure(JwtBearerOptions options) => Configure(Options.DefaultName, options);

    private Task ChallengeAsync(JwtBearerChallengeContext context)
    {
        context.HandleResponse();
        var metadataUrl = McpResource.MetadataUrlOf(McpResource.UrlOf(context.Request, mcpOptions.Value));
        var invalidToken = context.AuthenticateFailure is not null || context.Request.Headers.Authorization.Count > 0;
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.Headers.WWWAuthenticate = McpResource.UnauthorizedChallenge(metadataUrl, invalidToken);
        return Task.CompletedTask;
    }
}
