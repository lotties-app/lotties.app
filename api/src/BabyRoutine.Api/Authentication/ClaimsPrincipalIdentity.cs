using System.Security.Claims;
using BabyRoutine.Domain.Users;

namespace BabyRoutine.Api.Authentication;

internal static class ClaimsPrincipalIdentity
{
    /// <summary>The OIDC identity of an authenticated principal with a non-blank <c>sub</c> claim; otherwise null.</summary>
    public static ExternalIdentity? ToExternalIdentity(this ClaimsPrincipal? principal) =>
        principal is { Identity.IsAuthenticated: true } && ReadClaim(principal, OidcClaims.Subject) is { } subject
            ? new ExternalIdentity(subject, ReadClaim(principal, OidcClaims.Name), ReadClaim(principal, OidcClaims.Email))
            : null;

    private static string? ReadClaim(ClaimsPrincipal principal, string type) =>
        principal.FindFirst(type)?.Value is { } value && !string.IsNullOrWhiteSpace(value) ? value : null;
}
