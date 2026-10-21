using Lotties.Api.Tests.Support;
using Lotties.Application.Babies;
using Lotties.Domain.Babies;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Application;

public sealed class BabyAccessServiceTests
{
    private static readonly User CurrentUser = User.Create(User.UnknownIssuer, "sub", "Ana", TestUsers.Now);

    [Fact]
    public async Task CheckAsync_NoMembership_ReturnsNotMember()
    {
        var service = CreateService();

        var decision = await service.CheckAsync(Guid.NewGuid(), BabyRole.Viewer);

        Assert.Equal(BabyAccessDecision.NotMember, decision);
    }

    [Fact]
    public async Task CheckAsync_MembershipOfOtherUser_ReturnsNotMember()
    {
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), Guid.NewGuid(), TestUsers.Now);
        var service = CreateService(baby.Members.Single());

        var decision = await service.CheckAsync(baby.Id, BabyRole.Viewer);

        Assert.Equal(BabyAccessDecision.NotMember, decision);
    }

    [Theory]
    [InlineData(BabyRole.Viewer, BabyRole.Viewer, BabyAccessDecision.Granted)]
    [InlineData(BabyRole.Viewer, BabyRole.Parent, BabyAccessDecision.InsufficientRole)]
    [InlineData(BabyRole.Parent, BabyRole.Parent, BabyAccessDecision.Granted)]
    [InlineData(BabyRole.Parent, BabyRole.Owner, BabyAccessDecision.InsufficientRole)]
    public async Task CheckAsync_CurrentUserMember_DecidesByRole(BabyRole role, BabyRole requiredRole, BabyAccessDecision expected)
    {
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), Guid.NewGuid(), TestUsers.Now);
        var service = CreateService(baby.AddMember(CurrentUser.Id, role, TestUsers.Now));

        var decision = await service.CheckAsync(baby.Id, requiredRole);

        Assert.Equal(expected, decision);
    }

    private static BabyAccessService CreateService(params BabyMember[] members) => new(
        new FakeCurrentUser(CurrentUser),
        new FakeMembershipRepository(members),
        NullLogger<BabyAccessService>.Instance);
}
