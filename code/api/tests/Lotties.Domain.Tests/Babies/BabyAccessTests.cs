using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Babies;

public sealed class BabyAccessTests
{
    [Theory]
    [InlineData(BabyRole.Owner, BabyRole.Owner, true)]
    [InlineData(BabyRole.Owner, BabyRole.Parent, true)]
    [InlineData(BabyRole.Owner, BabyRole.Caregiver, true)]
    [InlineData(BabyRole.Owner, BabyRole.Viewer, true)]
    [InlineData(BabyRole.Parent, BabyRole.Owner, false)]
    [InlineData(BabyRole.Parent, BabyRole.Parent, true)]
    [InlineData(BabyRole.Parent, BabyRole.Caregiver, true)]
    [InlineData(BabyRole.Parent, BabyRole.Viewer, true)]
    [InlineData(BabyRole.Caregiver, BabyRole.Owner, false)]
    [InlineData(BabyRole.Caregiver, BabyRole.Parent, false)]
    [InlineData(BabyRole.Caregiver, BabyRole.Caregiver, true)]
    [InlineData(BabyRole.Caregiver, BabyRole.Viewer, true)]
    [InlineData(BabyRole.Viewer, BabyRole.Owner, false)]
    [InlineData(BabyRole.Viewer, BabyRole.Parent, false)]
    [InlineData(BabyRole.Viewer, BabyRole.Caregiver, false)]
    [InlineData(BabyRole.Viewer, BabyRole.Viewer, true)]
    public void Satisfies_RoleAgainstRequiredRole_FollowsOwnerParentCaregiverViewerOrder(BabyRole role, BabyRole requiredRole, bool expected)
    {
        Assert.Equal(expected, role.Satisfies(requiredRole));
    }

    [Theory]
    [InlineData(BabyRole.Owner, true, true, true)]
    [InlineData(BabyRole.Parent, true, true, false)]
    [InlineData(BabyRole.Caregiver, false, true, false)]
    [InlineData(BabyRole.Viewer, false, false, false)]
    public void Rules_ByRole_GrantWriteLogAndManageMembers(BabyRole role, bool canWrite, bool canLog, bool canManage)
    {
        Assert.Equal((canWrite, canLog, canManage), (role.CanWrite(), role.CanLogEvents(), role.CanManageMembers()));
    }

    [Theory]
    [InlineData(BabyRole.Owner, true, true)]
    [InlineData(BabyRole.Parent, true, true)]
    [InlineData(BabyRole.Caregiver, true, false)]
    [InlineData(BabyRole.Viewer, false, false)]
    public void CanChangeEvent_OwnAndOthersEvents_OnlyOwnForCaregiver(BabyRole role, bool own, bool others)
    {
        var userId = Guid.NewGuid();

        var result = (role.CanChangeEvent(createdBy: userId, userId), role.CanChangeEvent(createdBy: Guid.NewGuid(), userId));

        Assert.Equal((own, others), result);
    }

    [Fact]
    public void BabyMember_Caregiver_LogsButDoesNotWrite()
    {
        var member = MemberWithRole(BabyRole.Caregiver);

        Assert.Equal((true, false, false), (member.CanLogEvents, member.CanWrite, member.CanManageMembers));
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
    public void Decide_CaregiverAgainstParent_IsInsufficientRole()
    {
        var member = MemberWithRole(BabyRole.Caregiver);

        Assert.Equal(BabyAccessDecision.InsufficientRole, BabyAccess.Decide(member, BabyRole.Parent));
    }

    [Fact]
    public void Decide_CaregiverAgainstCaregiver_IsGranted()
    {
        var member = MemberWithRole(BabyRole.Caregiver);

        Assert.Equal(BabyAccessDecision.Granted, BabyAccess.Decide(member, BabyRole.Caregiver));
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
