using System.Security.Claims;

namespace Lotties.Api.Assistants.Mcp;

/// <summary>
/// The OAuth scopes of the MCP server (docs/design/32-assistants.md section 9): <see cref="Read"/> opens the read tools,
/// <see cref="Write"/> the logging tools. They are independent (neither implies the other) and read from the access token's
/// <c>scope</c> claim (space-separated, as Keycloak issues it) or <c>scp</c> claims. A token with neither reaches nothing.
/// </summary>
public static class McpScopes
{
    public const string Read = "lotties.read";
    public const string Write = "lotties.write";

    /// <summary>Every scope the resource knows, as its protected resource metadata lists them.</summary>
    public static IReadOnlyList<string> All { get; } = [Read, Write];

    private const string ScopeClaim = "scope";
    private const string ScpClaim = "scp";

    /// <summary>The <see cref="All"/> scopes <paramref name="user"/>'s token grants.</summary>
    public static IReadOnlySet<string> Of(ClaimsPrincipal? user)
    {
        if (user is null)
        {
            return new HashSet<string>(StringComparer.Ordinal);
        }

        var granted = user.FindAll(ScopeClaim).Concat(user.FindAll(ScpClaim))
            .SelectMany(claim => claim.Value.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return granted.Where(All.Contains).ToHashSet(StringComparer.Ordinal);
    }

    /// <summary>Whether <paramref name="user"/>'s token grants <paramref name="scope"/>.</summary>
    public static bool Grants(ClaimsPrincipal? user, string scope) => Of(user).Contains(scope);
}
