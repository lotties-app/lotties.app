using System.Security.Claims;
using Lotties.Api.Authentication;
using Lotties.Api.Authorization;
using Lotties.Api.Endpoints;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Authorization;

public sealed class BabyAccessHandlerTests
{
    private static readonly BabyAccessRequirement WriteRequirement = new(BabyRole.Parent);

    [Fact]
    public async Task HandleAsync_Granted_Succeeds()
    {
        var context = CreateContext(Authenticated(), WithBabyId(Guid.NewGuid()));

        await CreateHandler(BabyAccessDecision.Granted).HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    [Theory]
    [InlineData(BabyAccessDecision.NotMember)]
    [InlineData(BabyAccessDecision.InsufficientRole)]
    public async Task HandleAsync_Denied_Fails(BabyAccessDecision decision)
    {
        var context = CreateContext(Authenticated(), WithBabyId(Guid.NewGuid()));

        await CreateHandler(decision).HandleAsync(context);

        Assert.True(context.HasFailed);
    }

    [Fact]
    public async Task HandleAsync_ValidRoute_ChecksRouteBabyWithRequiredRole()
    {
        var babyId = Guid.NewGuid();
        var access = new FakeBabyAccessService(BabyAccessDecision.Granted);

        await new BabyAccessHandler(access, NullLogger<BabyAccessHandler>.Instance).HandleAsync(CreateContext(Authenticated(), WithBabyId(babyId)));

        Assert.Equal((babyId, BabyRole.Parent), Assert.Single(access.Calls));
    }

    [Fact]
    public async Task HandleAsync_Anonymous_LeavesDecisionToAuthenticationWithoutLookup()
    {
        var access = new FakeBabyAccessService(BabyAccessDecision.Granted);
        var context = CreateContext(new ClaimsPrincipal(new ClaimsIdentity()), WithBabyId(Guid.NewGuid()));

        await new BabyAccessHandler(access, NullLogger<BabyAccessHandler>.Instance).HandleAsync(context);

        Assert.False(context.HasSucceeded);
        Assert.False(context.HasFailed);
        Assert.Empty(access.Calls);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-guid")]
    public async Task HandleAsync_MissingOrInvalidBabyId_Fails(string? routeValue)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.RouteValues[BabyRoutes.BabyIdParameter] = routeValue;
        var context = CreateContext(Authenticated(), httpContext);

        await CreateHandler(BabyAccessDecision.Granted).HandleAsync(context);

        Assert.True(context.HasFailed);
    }

    [Fact]
    public async Task HandleAsync_ResourceNotHttpContext_Fails()
    {
        var context = CreateContext(Authenticated(), resource: null);

        await CreateHandler(BabyAccessDecision.Granted).HandleAsync(context);

        Assert.True(context.HasFailed);
    }

    private static BabyAccessHandler CreateHandler(BabyAccessDecision decision) =>
        new(new FakeBabyAccessService(decision), NullLogger<BabyAccessHandler>.Instance);

    private static AuthorizationHandlerContext CreateContext(ClaimsPrincipal user, object? resource) =>
        new([WriteRequirement], user, resource);

    private static ClaimsPrincipal Authenticated() =>
        new(new ClaimsIdentity([new Claim(OidcClaims.Subject, "sub")], TestAuthHandler.SchemeName));

    private static DefaultHttpContext WithBabyId(Guid babyId)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.RouteValues[BabyRoutes.BabyIdParameter] = babyId.ToString();
        return httpContext;
    }
}
