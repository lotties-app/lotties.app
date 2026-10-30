using System.Security.Claims;
using System.Text.Json;
using Lotties.Api.Authentication;
using Lotties.Application.Board;
using Lotties.Domain.Board;
using Microsoft.AspNetCore.Authentication;

namespace Lotties.Api.Board;

/// <summary>
/// The claims the board's authorization reads (docs/design/36-project-board.md section 4): the permission claims
/// (<see cref="Permission"/>: <c>read</c>, <c>write</c>, <c>admin</c>) that both a user's board realm roles and an API key's
/// scope become, and the key's id and topics.
/// </summary>
internal static class BoardClaims
{
    public const string Permission = "lotties_board";
    public const string Read = "read";
    public const string Write = "write";
    public const string Admin = "admin";

    /// <summary>The API key's id (only on a key's principal).</summary>
    public const string KeyId = "lotties_board_key";

    /// <summary>One claim per topic a key is limited to (none: every topic).</summary>
    public const string Topic = "lotties_board_topic";

    /// <summary>The claim Keycloak puts realm roles in: <c>{"roles": [...]}</c>.</summary>
    public const string RealmAccess = "realm_access";

    public const string ReaderRole = "lotties-board-reader";
    public const string WriterRole = "lotties-board-writer";
    public const string AdminRole = "lotties-board-admin";

    /// <summary>The board realm roles, weakest first; any other realm role is ignored.</summary>
    public static IReadOnlyList<string> Roles { get; } = [ReaderRole, WriterRole, AdminRole];

    /// <summary>The permissions of a set of board roles (admin implies writer implies reader).</summary>
    public static IReadOnlyList<string> PermissionsOf(IReadOnlyCollection<string> roles) =>
        roles.Contains(AdminRole) ? [Read, Write, Admin]
        : roles.Contains(WriterRole) ? [Read, Write]
        : roles.Contains(ReaderRole) ? [Read]
        : [];

    /// <summary>The realm roles of every <c>realm_access</c> claim (malformed values are ignored).</summary>
    public static IEnumerable<string> RealmRolesOf(ClaimsPrincipal principal)
    {
        ArgumentNullException.ThrowIfNull(principal);
        foreach (var claim in principal.FindAll(RealmAccess))
        {
            foreach (var role in RolesIn(claim.Value))
            {
                yield return role;
            }
        }
    }

    /// <summary>The caller's board access from her principal (an API key's or a user's).</summary>
    public static BoardAccess AccessOf(ClaimsPrincipal? principal)
    {
        var permissions = principal?.FindAll(Permission).Select(claim => claim.Value).ToHashSet(StringComparer.Ordinal) ?? [];
        if (principal?.FindFirst(KeyId)?.Value is { } keyId && Guid.TryParse(keyId, out var id))
        {
            var topics = principal.FindAll(Topic).Select(claim => claim.Value).ToArray();
            return new BoardAccess
            {
                Kind = BoardActorKind.ApiKey,
                Name = principal.FindFirst(OidcClaims.Name)?.Value ?? "API key",
                CanRead = permissions.Contains(Read),
                CanWrite = permissions.Contains(Write),
                CanAdmin = false,
                KeyId = id,
                Scope = permissions.Contains(Write) ? BoardKeyScope.Write : BoardKeyScope.Read,
                AllowedTopics = topics.Length == 0 ? null : topics,
            };
        }

        return new BoardAccess
        {
            Kind = BoardActorKind.User,
            Name = NameOf(principal),
            CanRead = permissions.Contains(Read),
            CanWrite = permissions.Contains(Write),
            CanAdmin = permissions.Contains(Admin),
            Roles = principal?.FindAll(ClaimTypes.Role).Select(claim => claim.Value).Where(Roles.Contains).Distinct(StringComparer.Ordinal).ToArray() ?? [],
        };
    }

    private static string NameOf(ClaimsPrincipal? principal) =>
        principal?.ToExternalIdentity()?.DisplayName ?? "Board user";

    private static IReadOnlyList<string> RolesIn(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("roles", out var roles)
                && roles.ValueKind == JsonValueKind.Array
                ? roles.EnumerateArray().Where(role => role.ValueKind == JsonValueKind.String).Select(role => role.GetString()!).ToArray()
                : [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}

/// <summary>
/// Turns Keycloak's <c>realm_access.roles</c> into board claims for exactly the three board roles
/// (<see cref="BoardClaims.Roles"/>): a role claim (<see cref="ClaimTypes.Role"/>) per role and the permission claims, in an
/// extra identity. Every other realm role is ignored. A board key's principal, or one already transformed, is left alone
/// (the transformation runs on every authentication).
/// </summary>
internal sealed class BoardRoleClaimsTransformation : IClaimsTransformation
{
    public const string AuthenticationType = "BoardRoles";

    public Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
    {
        ArgumentNullException.ThrowIfNull(principal);
        if (principal.Identities.Any(identity => identity.AuthenticationType is AuthenticationType or BoardKeyAuthenticationHandler.SchemeName))
        {
            return Task.FromResult(principal);
        }

        var roles = BoardClaims.RealmRolesOf(principal).Where(BoardClaims.Roles.Contains).Distinct(StringComparer.Ordinal).ToArray();
        if (roles.Length == 0)
        {
            return Task.FromResult(principal);
        }

        var claims = roles.Select(role => new Claim(ClaimTypes.Role, role))
            .Concat(BoardClaims.PermissionsOf(roles).Select(permission => new Claim(BoardClaims.Permission, permission)));
        var transformed = principal.Clone();
        transformed.AddIdentity(new ClaimsIdentity(claims, AuthenticationType, OidcClaims.Name, ClaimTypes.Role));
        return Task.FromResult(transformed);
    }
}
