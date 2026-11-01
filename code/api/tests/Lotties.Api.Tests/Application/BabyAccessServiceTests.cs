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

    [Fact]
    public async Task CheckScopeAsync_NoMembership_ReturnsNotMember()
    {
        var decision = await CreateService().CheckScopeAsync(Guid.NewGuid(), DoctorScope.Growth);

        Assert.Equal(BabyAccessDecision.NotMember, decision);
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public async Task CheckScopeAsync_AnyRoleButTheDoctor_IsGrantedWhateverTheScope(BabyRole role)
    {
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), Guid.NewGuid(), TestUsers.Now);
        var service = CreateService(baby.AddMember(CurrentUser.Id, role, TestUsers.Now));

        Assert.Equal(BabyAccessDecision.Granted, await service.CheckScopeAsync(baby.Id, DoctorScope.Notes));
        Assert.Equal(BabyAccessDecision.Granted, await service.CheckScopeAsync(baby.Id, scope: null));
    }

    [Fact]
    public async Task CheckScopeAsync_Doctor_NeedsTheScopeAndNeverPassesARouteWithoutOne()
    {
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), Guid.NewGuid(), TestUsers.Now);
        baby.AddMember(CurrentUser.Id, BabyRole.Doctor, TestUsers.Now);
        var member = baby.ChangeDoctorScopes(CurrentUser.Id, DoctorScopeSet.Create([DoctorScope.Growth]));
        var service = CreateService(member);

        Assert.Equal(BabyAccessDecision.Granted, await service.CheckScopeAsync(baby.Id, DoctorScope.Growth));
        Assert.Equal(BabyAccessDecision.ScopeNotGranted, await service.CheckScopeAsync(baby.Id, DoctorScope.Notes));
        Assert.Equal(BabyAccessDecision.ScopeNotGranted, await service.CheckScopeAsync(baby.Id, scope: null));
    }

    [Fact]
    public async Task FindMembershipAsync_ReturnsTheMembershipWithItsScopes_OrNullForANonMember()
    {
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), Guid.NewGuid(), TestUsers.Now);
        baby.AddMember(CurrentUser.Id, BabyRole.Doctor, TestUsers.Now, DoctorScopeSet.Create([DoctorScope.Vaccines]));
        var service = CreateService(baby.FindMember(CurrentUser.Id)!);

        var found = await service.FindMembershipAsync(baby.Id);
        var unknown = await service.FindMembershipAsync(Guid.NewGuid());

        Assert.Equal(["vaccines"], found!.EffectiveDoctorScopes.Codes);
        Assert.Null(unknown);
    }

    [Fact]
    public async Task FindMembershipAsync_IsReadOnceForTheRequest_ThenReused()
    {
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), Guid.NewGuid(), TestUsers.Now);
        var repository = new CountingMembershipRepository(baby.AddMember(CurrentUser.Id, BabyRole.Doctor, TestUsers.Now));
        var service = new BabyAccessService(new FakeCurrentUser(CurrentUser), repository, NullLogger<BabyAccessService>.Instance);

        await service.CheckScopeAsync(baby.Id, DoctorScope.Growth);
        await service.CheckAsync(baby.Id, BabyRole.Viewer);
        await service.FindRoleAsync(baby.Id);
        await service.FindMembershipAsync(baby.Id);

        Assert.Equal(1, repository.Lookups);
    }

    private sealed class CountingMembershipRepository(BabyMember member) : IBabyMembershipRepository
    {
        public int Lookups { get; private set; }

        public Task<BabyMember?> FindAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default)
        {
            Lookups++;
            return Task.FromResult<BabyMember?>(member);
        }
    }

    private static BabyAccessService CreateService(params BabyMember[] members) => new(
        new FakeCurrentUser(CurrentUser),
        new FakeMembershipRepository(members),
        NullLogger<BabyAccessService>.Instance);
}
