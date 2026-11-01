using System.Security.Claims;
using BabyRoutine.Domain.Users;

namespace BabyRoutine.Api.Authentication;

internal static class ClaimsPrincipalIdentity
{
    /// <summary>
    /// The OIDC identity of an authenticated principal with a non-blank <c>sub</c> claim; otherwise null. The issuer is
    /// the <c>iss</c> claim (validated by the JWT bearer handler), or <see cref="User.UnknownIssuer"/> when absent.
    /// </summary>
    public static ExternalIdentity? ToExternalIdentity(this ClaimsPrincipal? principal) =>
        principal is { Identity.IsAuthenticated: true } && ReadClaim(principal, OidcClaims.Subject) is { } subject
            ? new ExternalIdentity(
                ReadClaim(principal, OidcClaims.Issuer) ?? User.UnknownIssuer,
                subject,
                ReadClaim(principal, OidcClaims.Name),
                ReadClaim(principal, OidcClaims.PreferredUsername),
                ReadClaim(principal, OidcClaims.Nickname))
            : null;

    private static string? ReadClaim(ClaimsPrincipal principal, string type) =>
        principal.FindFirst(type)?.Value is { } value && !string.IsNullOrWhiteSpace(value) ? value : null;
}
