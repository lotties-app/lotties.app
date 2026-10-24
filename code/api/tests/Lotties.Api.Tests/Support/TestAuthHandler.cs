using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Lotties.Api.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// Authenticates from <c>X-Test-Sub</c> / <c>X-Test-Iss</c> / <c>X-Test-Name</c> / <c>X-Test-Preferred-Username</c> /
/// <c>X-Test-Nickname</c> / <c>X-Test-Email</c> headers, emitting raw OIDC claim names (<c>email</c> included, which the
/// API must ignore) as the JWT bearer scheme does with inbound claim mapping off, and Keycloak realm roles from
/// <c>X-Test-Realm-Roles</c> as the <c>realm_access</c> JSON claim. No <c>X-Test-Sub</c> header means
/// anonymous; no <c>X-Test-Iss</c> header means a token without <c>iss</c>.
/// </summary>
internal sealed class TestAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Test";
    public const string SubjectHeader = "X-Test-Sub";
    public const string NameHeader = "X-Test-Name";
    public const string IssuerHeader = "X-Test-Iss";
    public const string PreferredUsernameHeader = "X-Test-Preferred-Username";
    public const string NicknameHeader = "X-Test-Nickname";
    public const string EmailHeader = "X-Test-Email";

    /// <summary>Comma-separated Keycloak realm roles, emitted as the token's <c>realm_access</c> JSON claim (<c>{"roles":[...]}</c>).</summary>
    public const string RealmRolesHeader = "X-Test-Realm-Roles";
    private const string EmailClaim = "email";
    private const string RealmAccessClaim = "realm_access";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var subject = Request.Headers[SubjectHeader].ToString();
        if (string.IsNullOrEmpty(subject))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var claims = new[]
            {
                new Claim(OidcClaims.Subject, subject),
                new Claim(OidcClaims.Issuer, Request.Headers[IssuerHeader].ToString()),
                new Claim(OidcClaims.Name, Request.Headers[NameHeader].ToString()),
                new Claim(OidcClaims.PreferredUsername, Request.Headers[PreferredUsernameHeader].ToString()),
                new Claim(OidcClaims.Nickname, Request.Headers[NicknameHeader].ToString()),
                new Claim(EmailClaim, Request.Headers[EmailHeader].ToString()),
                RealmAccess(Request.Headers[RealmRolesHeader].ToString()),
            }
            .Where(claim => claim.Value.Length > 0);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName, OidcClaims.Name, null));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName)));
    }

    /// <summary>The <c>realm_access</c> claim as the JWT handler emits it with inbound mapping off (a JSON value); empty without roles.</summary>
    private static Claim RealmAccess(string roles) =>
        roles.Length == 0
            ? new Claim(RealmAccessClaim, string.Empty)
            : new Claim(RealmAccessClaim, JsonSerializer.Serialize(new { roles = roles.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) }), "JSON");
}
