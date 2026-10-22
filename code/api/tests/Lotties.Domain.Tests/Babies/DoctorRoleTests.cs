using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Babies;

/// <summary>The Doctor role (docs/design/16-doctor-access.md): reads, writes her notes and measurements, nothing else.</summary>
public sealed class DoctorRoleTests
{
    private static readonly Guid OwnerId = Guid.NewGuid();

    [Theory]
    [InlineData(BabyRole.Owner, false)]
    [InlineData(BabyRole.Parent, false)]
    [InlineData(BabyRole.Caregiver, false)]
    [InlineData(BabyRole.Viewer, true)]
    [InlineData(BabyRole.Doctor, true)]
    public void Satisfies_DoctorAgainstEachRequiredRole_OnlyViewerAndDoctor(BabyRole requiredRole, bool expected)
    {
        Assert.Equal(expected, BabyRole.Doctor.Satisfies(requiredRole));
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void Satisfies_RequiredDoctor_NoOtherRole(BabyRole role)
    {
        Assert.False(role.Satisfies(BabyRole.Doctor));
    }

    [Fact]
    public void Rules_Doctor_ReadsAndWritesOnlyNotesAndMeasurements()
    {
        var doctor = BabyRole.Doctor;

        Assert.Equal(
            (false, false, false, true, true, true),
            (doctor.CanWrite(), doctor.CanLogEvents(), doctor.CanManageMembers(), doctor.CanAuthorNotes(), doctor.CanRecordMeasurements(), doctor.RequiresProfessionalProfile()));
    }

    [Theory]
    [InlineData(BabyRole.Owner, true, true)]
    [InlineData(BabyRole.Parent, true, true)]
    [InlineData(BabyRole.Caregiver, false, false)]
    [InlineData(BabyRole.Viewer, false, false)]
    [InlineData(BabyRole.Doctor, true, false)]
    public void CanChangeMeasurement_OwnAndOthers_DoctorOnlyHerOwn(BabyRole role, bool own, bool others)
    {
        var userId = Guid.NewGuid();

        var result = (role.CanChangeMeasurement(createdBy: userId, userId), role.CanChangeMeasurement(createdBy: Guid.NewGuid(), userId));

        Assert.Equal((own, others), result);
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void CanAuthorNotes_OtherRoles_False(BabyRole role)
    {
        Assert.False(role.CanAuthorNotes());
    }

    [Fact]
    public void AdmitWith_DoctorInviteWithoutProfessionalProfile_ThrowsAndLeavesTheInviteUsable()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var invite = Invite.Issue(baby.Id, BabyRole.Doctor, OwnerId, TestClock.Now, TimeSpan.FromDays(7)).Invite;
        var doctorId = Guid.NewGuid();

        var error = Assert.Throws<ProfessionalProfileRequiredException>(() => baby.AdmitWith(invite, doctorId, TestClock.Now));

        Assert.Equal("professional_profile_required", error.Code);
        Assert.False(invite.IsAccepted);
        Assert.Null(baby.FindMember(doctorId));
    }

    [Fact]
    public void AdmitWith_DoctorInviteWithProfessionalProfile_JoinsAsDoctor()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var invite = Invite.Issue(baby.Id, BabyRole.Doctor, OwnerId, TestClock.Now, TimeSpan.FromDays(7)).Invite;

        var member = baby.AdmitWith(invite, Guid.NewGuid(), TestClock.Now, isDeclaredProfessional: true);

        Assert.Equal(BabyRole.Doctor, member.Role);
        Assert.True(invite.IsAccepted);
    }

    [Fact]
    public void AdmitWith_ParentInviteWithoutProfile_NeedsNone()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var invite = Invite.Issue(baby.Id, BabyRole.Parent, OwnerId, TestClock.Now, TimeSpan.FromDays(7)).Invite;

        Assert.Equal(BabyRole.Parent, baby.AdmitWith(invite, Guid.NewGuid(), TestClock.Now).Role);
    }

    [Fact]
    public void ChangeMemberRole_ToDoctorWithoutProfile_Throws()
    {
        var baby = Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);
        var memberId = Guid.NewGuid();
        baby.AddMember(memberId, BabyRole.Viewer, TestClock.Now);

        Assert.Throws<ProfessionalProfileRequiredException>(() => baby.ChangeMemberRole(memberId, BabyRole.Doctor));
        Assert.Equal(BabyRole.Doctor, baby.ChangeMemberRole(memberId, BabyRole.Doctor, isDeclaredProfessional: true).Role);
    }
}
