using System.Security.Claims;
using Lotties.Api.Authentication;
using Lotties.Domain.Users;

namespace Lotties.Api.Tests.Authentication;

public sealed class ClaimsPrincipalIdentityTests
{
    [Fact]
    public void ToExternalIdentity_AuthenticatedWithClaims_MapsIssuerSubjectAndProfileButNotEmail()
    {
        var principal = Principal(
            isAuthenticated: true,
            (OidcClaims.Issuer, "https://issuer.example.test/"),
            (OidcClaims.Subject, "sub"),
            (OidcClaims.Name, "Ana"),
            (OidcClaims.PreferredUsername, "ana.s"),
            (OidcClaims.Nickname, "ana"),
            ("email", "ana@example.test"));

        Assert.Equal(new ExternalIdentity("https://issuer.example.test/", "sub", "Ana", "ana.s", "ana"), principal.ToExternalIdentity());
    }

    [Fact]
    public void ToExternalIdentity_OnlySubject_HasUnknownIssuerAndNoProfile()
    {
        var identity = Principal(isAuthenticated: true, (OidcClaims.Subject, "sub"), ("email", "ana@example.test")).ToExternalIdentity();

        Assert.Equal(new ExternalIdentity(User.UnknownIssuer, "sub", null), identity);
        Assert.Equal(ExternalIdentity.FallbackDisplayName, identity!.DisplayName);
    }

    [Fact]
    public void ToExternalIdentity_NoSubject_ReturnsNull()
    {
        Assert.Null(Principal(isAuthenticated: true, (OidcClaims.Name, "Ana")).ToExternalIdentity());
    }

    [Fact]
    public void ToExternalIdentity_Anonymous_ReturnsNull()
    {
        Assert.Null(Principal(isAuthenticated: false, (OidcClaims.Subject, "sub")).ToExternalIdentity());
    }

    private static ClaimsPrincipal Principal(bool isAuthenticated, params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(claim => new Claim(claim.Type, claim.Value)), isAuthenticated ? "jwt" : null));
}
