using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Babies;

public sealed class BabyTests
{
    private static readonly Guid OwnerId = Guid.NewGuid();

    [Fact]
    public void Create_ValidInput_AddsCreatorAsOwner()
    {
        var baby = Baby.Create(" Lia ", TestClock.Today, OwnerId, TestClock.Now);

        var owner = Assert.Single(baby.Members);
        Assert.Equal("Lia", baby.Name);
        Assert.Equal(OwnerId, owner.UserId);
        Assert.Equal(baby.Id, owner.BabyId);
        Assert.Equal(BabyRole.Owner, owner.Role);
    }

    [Fact]
    public void Create_BirthDateUtcTomorrow_IsAcceptedForTimeZonesAheadOfUtc()
    {
        var lateUtcEvening = new DateTimeOffset(2026, 1, 10, 23, 30, 0, TimeSpan.Zero);

        var baby = Baby.Create("Lia", new DateOnly(2026, 1, 11), OwnerId, lateUtcEvening);

        Assert.Equal(new DateOnly(2026, 1, 11), baby.BirthDate);
    }

    [Fact]
    public void UpdateDetails_BirthDateUtcTomorrow_IsAccepted()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        baby.UpdateDetails("Lia", TestClock.Today.AddDays(1), TestClock.Now);

        Assert.Equal(TestClock.Today.AddDays(1), baby.BirthDate);
    }

    [Fact]
    public void Create_BirthDateAfterUtcTomorrow_ThrowsValidation()
    {
        var exception = Assert.Throws<DomainValidationException>(
            () => Baby.Create("Lia", TestClock.Today.AddDays(2), OwnerId, TestClock.Now));

        Assert.Equal(nameof(Baby.BirthDate), exception.Field);
    }

    [Fact]
    public void Create_BlankName_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => Baby.Create(" ", TestClock.Today, OwnerId, TestClock.Now));
    }

    [Fact]
    public void Create_NameTooLong_ThrowsValidation()
    {
        var name = new string('a', Baby.NameMaxLength + 1);

        Assert.Throws<DomainValidationException>(() => Baby.Create(name, TestClock.Today, OwnerId, TestClock.Now));
    }

    [Fact]
    public void Create_EmptyOwner_ThrowsArgument()
    {
        Assert.Throws<ArgumentException>(() => Baby.Create("Lia", TestClock.Today, Guid.Empty, TestClock.Now));
    }

    [Fact]
    public void UpdateDetails_Valid_ChangesNameAndBirthDate()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        baby.UpdateDetails("Lia Maria", TestClock.Today.AddDays(-3), TestClock.Now);

        Assert.Equal("Lia Maria", baby.Name);
        Assert.Equal(TestClock.Today.AddDays(-3), baby.BirthDate);
    }

    [Fact]
    public void UpdateDetails_FutureBirthDate_ThrowsAndKeepsState()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        Assert.Throws<DomainValidationException>(() => baby.UpdateDetails("Other", TestClock.Today.AddDays(2), TestClock.Now));
        Assert.Equal("Lia", baby.Name);
        Assert.Equal(TestClock.Today, baby.BirthDate);
    }

    [Fact]
    public void AddMember_NewUser_AddsWithRole()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var userId = Guid.NewGuid();

        var member = baby.AddMember(userId, BabyRole.Viewer, TestClock.Now);

        Assert.Equal(2, baby.Members.Count);
        Assert.Equal(BabyRole.Viewer, member.Role);
        Assert.Same(member, baby.FindMember(userId));
    }

    [Fact]
    public void AddMember_ExistingUser_ThrowsMemberAlreadyExists()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        Assert.Throws<MemberAlreadyExistsException>(() => baby.AddMember(OwnerId, BabyRole.Parent, TestClock.Now));
    }

    [Fact]
    public void AddMember_UndefinedRole_ThrowsValidation()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        Assert.Throws<DomainValidationException>(() => baby.AddMember(Guid.NewGuid(), (BabyRole)42, TestClock.Now));
    }

    [Fact]
    public void FindMember_UnknownUser_ReturnsNull()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        Assert.Null(baby.FindMember(Guid.NewGuid()));
    }

    [Fact]
    public void AdmitWith_ValidInvite_AcceptsInviteAndAddsMemberWithInviteRole()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var invite = Invite.Issue(baby.Id, BabyRole.Parent, OwnerId, TestClock.Now, TimeSpan.FromDays(1)).Invite;
        var userId = Guid.NewGuid();

        var member = baby.AdmitWith(invite, userId, TestClock.Now.AddHours(1));

        Assert.Equal(BabyRole.Parent, member.Role);
        Assert.True(invite.IsAccepted);
        Assert.Equal(userId, invite.AcceptedBy);
    }

    [Fact]
    public void AdmitWith_AlreadyMember_ThrowsAndLeavesInviteUnused()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var invite = Invite.Issue(baby.Id, BabyRole.Parent, OwnerId, TestClock.Now, TimeSpan.FromDays(1)).Invite;

        Assert.Throws<MemberAlreadyExistsException>(() => baby.AdmitWith(invite, OwnerId, TestClock.Now));
        Assert.False(invite.IsAccepted);
    }

    [Fact]
    public void AdmitWith_InviteForOtherBaby_ThrowsArgument()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var invite = Invite.Issue(Guid.NewGuid(), BabyRole.Parent, OwnerId, TestClock.Now, TimeSpan.FromDays(1)).Invite;

        Assert.Throws<ArgumentException>(() => baby.AdmitWith(invite, Guid.NewGuid(), TestClock.Now));
    }

    [Fact]
    public void AdmitWith_ExpiredInvite_ThrowsAndAddsNoMember()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var invite = Invite.Issue(baby.Id, BabyRole.Parent, OwnerId, TestClock.Now, TimeSpan.FromDays(1)).Invite;

        Assert.Throws<InviteExpiredException>(() => baby.AdmitWith(invite, Guid.NewGuid(), TestClock.Now.AddDays(2)));
        Assert.Single(baby.Members);
    }

    [Fact]
    public void ChangeMemberRole_Member_ChangesRole()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var parentId = Guid.NewGuid();
        baby.AddMember(parentId, BabyRole.Parent, TestClock.Now);

        var member = baby.ChangeMemberRole(parentId, BabyRole.Viewer);

        Assert.Equal(BabyRole.Viewer, member.Role);
        Assert.Equal(BabyRole.Viewer, baby.FindMember(parentId)!.Role);
    }

    [Fact]
    public void ChangeMemberRole_UnknownUser_ThrowsMemberNotFound()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        Assert.Throws<MemberNotFoundException>(() => baby.ChangeMemberRole(Guid.NewGuid(), BabyRole.Viewer));
    }

    [Fact]
    public void ChangeMemberRole_UndefinedRole_ThrowsValidation()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        Assert.Throws<DomainValidationException>(() => baby.ChangeMemberRole(OwnerId, (BabyRole)99));
    }

    [Fact]
    public void ChangeMemberRole_DemoteLastOwner_ThrowsAndKeepsOwner()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        baby.AddMember(Guid.NewGuid(), BabyRole.Parent, TestClock.Now);

        Assert.Throws<LastOwnerException>(() => baby.ChangeMemberRole(OwnerId, BabyRole.Parent));
        Assert.Equal(BabyRole.Owner, baby.FindMember(OwnerId)!.Role);
    }

    [Fact]
    public void ChangeMemberRole_DemoteOwnerWhenAnotherOwnerExists_Succeeds()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var coOwnerId = Guid.NewGuid();
        baby.AddMember(coOwnerId, BabyRole.Owner, TestClock.Now);

        baby.ChangeMemberRole(OwnerId, BabyRole.Viewer);

        Assert.Equal(BabyRole.Viewer, baby.FindMember(OwnerId)!.Role);
    }

    [Fact]
    public void ChangeMemberRole_LastOwnerKeepsOwner_Succeeds()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        var member = baby.ChangeMemberRole(OwnerId, BabyRole.Owner);

        Assert.Equal(BabyRole.Owner, member.Role);
    }

    [Fact]
    public void RemoveMember_NonOwner_RemovesThem()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var viewerId = Guid.NewGuid();
        baby.AddMember(viewerId, BabyRole.Viewer, TestClock.Now);

        baby.RemoveMember(viewerId);

        Assert.Null(baby.FindMember(viewerId));
        Assert.Single(baby.Members);
    }

    [Fact]
    public void RemoveMember_UnknownUser_ThrowsMemberNotFound()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        Assert.Throws<MemberNotFoundException>(() => baby.RemoveMember(Guid.NewGuid()));
    }

    [Fact]
    public void RemoveMember_LastOwner_ThrowsAndKeepsMember()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

        Assert.Throws<LastOwnerException>(() => baby.RemoveMember(OwnerId));
        Assert.NotNull(baby.FindMember(OwnerId));
    }

    [Fact]
    public void RemoveMember_OwnerWhenAnotherOwnerExists_Succeeds()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        baby.AddMember(Guid.NewGuid(), BabyRole.Owner, TestClock.Now);

        baby.RemoveMember(OwnerId);

        Assert.Null(baby.FindMember(OwnerId));
    }

    [Theory]
    [InlineData(BabyRole.Owner, true, true)]
    [InlineData(BabyRole.Parent, true, false)]
    [InlineData(BabyRole.Viewer, false, false)]
    public void RolePermissions_PerRole_MatchSpec(BabyRole role, bool canWrite, bool canManageMembers)
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var member = role == BabyRole.Owner ? baby.Members.Single() : baby.AddMember(Guid.NewGuid(), role, TestClock.Now);

        Assert.Equal((canWrite, canManageMembers), (member.CanWrite, member.CanManageMembers));
    }
}
