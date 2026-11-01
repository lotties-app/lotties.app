using System.Security.Claims;
using System.Text.Encodings.Web;
using BabyRoutine.Api.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Api.Tests.Support;

/// <summary>
/// Authenticates from <c>X-Test-Sub</c> / <c>X-Test-Iss</c> / <c>X-Test-Name</c> / <c>X-Test-Preferred-Username</c> /
/// <c>X-Test-Nickname</c> / <c>X-Test-Email</c> headers, emitting raw OIDC claim names (<c>email</c> included, which the
/// API must ignore) as the JWT bearer scheme does with inbound claim mapping off. No <c>X-Test-Sub</c> header means
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
    private const string EmailClaim = "email";

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
            }
            .Where(claim => claim.Value.Length > 0);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName, OidcClaims.Name, null));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName)));
    }
}
