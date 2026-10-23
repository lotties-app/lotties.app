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

public sealed class BabyScopeHandlerTests
{
    [Fact]
    public async Task HandleAsync_Granted_Succeeds()
    {
        var requirement = new BabyScopeRequirement(DoctorScope.Growth);
        var context = CreateContext(requirement, Authenticated(), WithBabyId(Guid.NewGuid()));

        await CreateHandler(BabyAccessDecision.Granted).HandleAsync(context);

        Assert.True(context.HasSucceeded);
    }

    [Theory]
    [InlineData(BabyAccessDecision.NotMember)]
    [InlineData(BabyAccessDecision.ScopeNotGranted)]
    [InlineData(BabyAccessDecision.InsufficientRole)]
    public async Task HandleAsync_Denied_Fails(BabyAccessDecision decision)
    {
        var context = CreateContext(new BabyScopeRequirement(DoctorScope.Growth), Authenticated(), WithBabyId(Guid.NewGuid()));

        await CreateHandler(decision).HandleAsync(context);

        Assert.True(context.HasFailed);
    }

    [Theory]
    [InlineData(DoctorScope.DailyLog)]
    [InlineData(DoctorScope.Notes)]
    public async Task HandleAsync_ChecksTheRouteBabyWithTheRequiredScope(DoctorScope scope)
    {
        var babyId = Guid.NewGuid();
        var access = new FakeBabyAccessService(BabyAccessDecision.Granted);

        await new BabyScopeHandler(access, NullLogger<BabyScopeHandler>.Instance).HandleAsync(CreateContext(new BabyScopeRequirement(scope), Authenticated(), WithBabyId(babyId)));

        Assert.Equal((babyId, (DoctorScope?)scope), Assert.Single(access.ScopeCalls));
    }

    [Fact]
    public async Task HandleAsync_FamilyRequirement_ChecksWithoutAScope()
    {
        var babyId = Guid.NewGuid();
        var access = new FakeBabyAccessService(BabyAccessDecision.Granted);

        await new BabyScopeHandler(access, NullLogger<BabyScopeHandler>.Instance).HandleAsync(CreateContext(new BabyScopeRequirement(null), Authenticated(), WithBabyId(babyId)));

        Assert.Equal((babyId, (DoctorScope?)null), Assert.Single(access.ScopeCalls));
    }

    [Fact]
    public async Task HandleAsync_Anonymous_LeavesTheDecisionToAuthenticationWithoutALookup()
    {
        var access = new FakeBabyAccessService(BabyAccessDecision.Granted);
        var context = CreateContext(new BabyScopeRequirement(DoctorScope.Growth), new ClaimsPrincipal(new ClaimsIdentity()), WithBabyId(Guid.NewGuid()));

        await new BabyScopeHandler(access, NullLogger<BabyScopeHandler>.Instance).HandleAsync(context);

        Assert.False(context.HasSucceeded);
        Assert.False(context.HasFailed);
        Assert.Empty(access.ScopeCalls);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("not-a-guid")]
    public async Task HandleAsync_MissingOrInvalidBabyId_Fails(string? routeValue)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.RouteValues[BabyRoutes.BabyIdParameter] = routeValue;
        var context = CreateContext(new BabyScopeRequirement(DoctorScope.Growth), Authenticated(), httpContext);

        await CreateHandler(BabyAccessDecision.Granted).HandleAsync(context);

        Assert.True(context.HasFailed);
    }

    [Fact]
    public async Task HandleAsync_ResourceNotHttpContext_Fails()
    {
        var context = CreateContext(new BabyScopeRequirement(DoctorScope.Growth), Authenticated(), resource: null);

        await CreateHandler(BabyAccessDecision.Granted).HandleAsync(context);

        Assert.True(context.HasFailed);
    }

    [Fact]
    public void ForScope_NamesThePolicyAfterTheWireCode()
    {
        Assert.Equal(
            ["BabyScope:daily_log", "BabyScope:growth", "BabyScope:medications", "BabyScope:vaccines", "BabyScope:formulas", "BabyScope:notes"],
            Enum.GetValues<DoctorScope>().Select(BabyPolicies.ForScope).ToArray());
        Assert.Equal(
            [BabyPolicies.ScopeDailyLog, BabyPolicies.ScopeGrowth, BabyPolicies.ScopeMedications, BabyPolicies.ScopeVaccines, BabyPolicies.ScopeFormulas, BabyPolicies.ScopeNotes],
            Enum.GetValues<DoctorScope>().Select(BabyPolicies.ForScope).ToArray());
    }

    private static BabyScopeHandler CreateHandler(BabyAccessDecision decision) =>
        new(new FakeBabyAccessService(decision), NullLogger<BabyScopeHandler>.Instance);

    private static AuthorizationHandlerContext CreateContext(BabyScopeRequirement requirement, ClaimsPrincipal user, object? resource) =>
        new([requirement], user, resource);

    private static ClaimsPrincipal Authenticated() =>
        new(new ClaimsIdentity([new Claim(OidcClaims.Subject, "sub")], TestAuthHandler.SchemeName));

    private static DefaultHttpContext WithBabyId(Guid babyId)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.RouteValues[BabyRoutes.BabyIdParameter] = babyId.ToString();
        return httpContext;
    }
}
