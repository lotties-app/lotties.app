using System.Security.Claims;
using System.Text.Encodings.Web;
using BabyRoutine.Api.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Api.Tests.Support;

/// <summary>
/// Authenticates from <c>X-Test-Sub</c> / <c>X-Test-Name</c> / <c>X-Test-Email</c> headers, emitting raw OIDC claim
/// names as the JWT bearer scheme does with inbound claim mapping off. No <c>X-Test-Sub</c> header means anonymous.
/// </summary>
internal sealed class TestAuthHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Test";
    public const string SubjectHeader = "X-Test-Sub";
    public const string NameHeader = "X-Test-Name";
    public const string EmailHeader = "X-Test-Email";

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
                new Claim(OidcClaims.Name, Request.Headers[NameHeader].ToString()),
                new Claim(OidcClaims.Email, Request.Headers[EmailHeader].ToString()),
            }
            .Where(claim => claim.Value.Length > 0);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName, OidcClaims.Name, null));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName)));
    }
}
