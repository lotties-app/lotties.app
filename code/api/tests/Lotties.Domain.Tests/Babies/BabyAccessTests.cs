using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Babies;

public sealed class BabyAccessTests
{
    [Theory]
    [InlineData(BabyRole.Owner, BabyRole.Owner, true)]
    [InlineData(BabyRole.Owner, BabyRole.Parent, true)]
    [InlineData(BabyRole.Owner, BabyRole.Viewer, true)]
    [InlineData(BabyRole.Parent, BabyRole.Owner, false)]
    [InlineData(BabyRole.Parent, BabyRole.Parent, true)]
    [InlineData(BabyRole.Parent, BabyRole.Viewer, true)]
    [InlineData(BabyRole.Viewer, BabyRole.Owner, false)]
    [InlineData(BabyRole.Viewer, BabyRole.Parent, false)]
    [InlineData(BabyRole.Viewer, BabyRole.Viewer, true)]
    public void Satisfies_RoleAgainstRequiredRole_FollowsOwnerParentViewerOrder(BabyRole role, BabyRole requiredRole, bool expected)
    {
        Assert.Equal(expected, role.Satisfies(requiredRole));
    }

    [Fact]
    public void Satisfies_UndefinedRole_IsFalse()
    {
        Assert.False(((BabyRole)42).Satisfies(BabyRole.Viewer));
    }

    [Fact]
    public void Satisfies_UndefinedRequiredRole_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => BabyRole.Owner.Satisfies((BabyRole)42));
    }

    [Fact]
    public void Decide_NoMembership_IsNotMember()
    {
        Assert.Equal(BabyAccessDecision.NotMember, BabyAccess.Decide(null, BabyRole.Viewer));
    }

    [Fact]
    public void Decide_RoleSatisfiesRequirement_IsGranted()
    {
        var member = MemberWithRole(BabyRole.Parent);

        Assert.Equal(BabyAccessDecision.Granted, BabyAccess.Decide(member, BabyRole.Parent));
    }

    [Fact]
    public void Decide_RoleBelowRequirement_IsInsufficientRole()
    {
        var member = MemberWithRole(BabyRole.Viewer);

        Assert.Equal(BabyAccessDecision.InsufficientRole, BabyAccess.Decide(member, BabyRole.Parent));
    }

    private static BabyMember MemberWithRole(BabyRole role)
    {
        var baby = Baby.Create("Lia", TestClock.Today, Guid.NewGuid(), TestClock.Now);
        return baby.AddMember(Guid.NewGuid(), role, TestClock.Now);
    }
}
