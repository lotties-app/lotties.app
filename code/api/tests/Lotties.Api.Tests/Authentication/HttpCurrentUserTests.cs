using System.Security.Claims;
using Lotties.Api.Authentication;
using Lotties.Api.Tests.Support;
using Microsoft.AspNetCore.Http;

namespace Lotties.Api.Tests.Authentication;

public sealed class HttpCurrentUserTests
{
    [Fact]
    public async Task GetUserAsync_CalledTwice_ProvisionsOncePerRequest()
    {
        var provisioning = new FakeUserProvisioningService();
        var currentUser = new HttpCurrentUser(AccessorFor((OidcClaims.Subject, "sub"), (OidcClaims.Name, "Ana")), provisioning);

        var first = await currentUser.GetUserAsync();
        var second = await currentUser.GetUserAsync();

        Assert.Same(first, second);
        Assert.Equal("sub", Assert.Single(provisioning.Calls).Subject);
    }

    [Fact]
    public async Task GetUserAsync_NoAuthenticatedIdentity_Throws()
    {
        var currentUser = new HttpCurrentUser(new HttpContextAccessor { HttpContext = new DefaultHttpContext() }, new FakeUserProvisioningService());

        Assert.False(currentUser.IsAuthenticated);
        await Assert.ThrowsAsync<InvalidOperationException>(() => currentUser.GetUserAsync());
    }

    private static HttpContextAccessor AccessorFor(params (string Type, string Value)[] claims) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(claims.Select(claim => new Claim(claim.Type, claim.Value)), "jwt")),
        },
    };
}
