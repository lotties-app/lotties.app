using System.Security.Claims;
using BabyRoutine.Api.Authentication;
using BabyRoutine.Domain.Users;

namespace BabyRoutine.Api.Tests.Authentication;

public sealed class ClaimsPrincipalIdentityTests
{
    [Fact]
    public void ToExternalIdentity_AuthenticatedWithClaims_MapsSubjectNameAndEmail()
    {
        var principal = Principal(isAuthenticated: true, (OidcClaims.Subject, "sub"), (OidcClaims.Name, "Ana"), (OidcClaims.Email, "ana@example.test"));

        Assert.Equal(new ExternalIdentity("sub", "Ana", "ana@example.test"), principal.ToExternalIdentity());
    }

    [Fact]
    public void ToExternalIdentity_OnlySubject_LeavesProfileNull()
    {
        var identity = Principal(isAuthenticated: true, (OidcClaims.Subject, "sub")).ToExternalIdentity();

        Assert.Null(identity!.Name);
        Assert.Null(identity.Email);
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
