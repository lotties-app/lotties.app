using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Babies;

/// <summary>Doctor scopes (docs/design/16-doctor-access.md): the sections of a baby's data the Owner lets a Doctor see.</summary>
public sealed class DoctorScopeTests
{
    private static readonly Guid OwnerId = Guid.NewGuid();
    private static readonly string[] AllCodes = ["daily_log", "growth", "medications", "vaccines", "formulas", "notes"];

    private static Baby NewBaby() => Baby.Create("Lia", TestClock.Today, OwnerId, TestClock.Now);

    [Fact]
    public void All_HasEverySectionInCanonicalOrder()
    {
        Assert.Equal(AllCodes, DoctorScopeSet.All.Codes);
        Assert.Equal(Enum.GetValues<DoctorScope>(), DoctorScopeSet.All.Values);
    }

    [Fact]
    public void None_HasNoSection()
    {
        Assert.Empty(DoctorScopeSet.None.Codes);
        Assert.All(Enum.GetValues<DoctorScope>(), scope => Assert.False(DoctorScopeSet.None.Contains(scope)));
    }

    [Theory]
    [InlineData(DoctorScope.DailyLog, "daily_log")]
    [InlineData(DoctorScope.Growth, "growth")]
    [InlineData(DoctorScope.Medications, "medications")]
    [InlineData(DoctorScope.Vaccines, "vaccines")]
    [InlineData(DoctorScope.Formulas, "formulas")]
    [InlineData(DoctorScope.Notes, "notes")]
    public void CodeOf_EachScope_IsItsWireCodeAndParsesBack(DoctorScope scope, string code)
    {
        Assert.Equal(code, DoctorScopes.CodeOf(scope));
        Assert.True(DoctorScopes.TryParse(code, out var parsed));
        Assert.Equal(scope, parsed);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Daily_Log")]
    [InlineData("dailylog")]
    public void TryParse_UnknownCode_IsFalse(string? code)
    {
        Assert.False(DoctorScopes.TryParse(code, out _));
    }

    [Fact]
    public void Parse_Codes_KeepsCanonicalOrderWhateverTheInputOrder()
    {
        var set = DoctorScopeSet.Parse(["notes", "daily_log", "growth"]);

        Assert.Equal(["daily_log", "growth", "notes"], set.Codes);
    }

    [Fact]
    public void Parse_Duplicates_Collapse()
    {
        var set = DoctorScopeSet.Parse(["growth", "growth", "vaccines", "growth"]);

        Assert.Equal(["growth", "vaccines"], set.Codes);
    }

    [Fact]
    public void Parse_EmptyList_IsTheEmptySet()
    {
        Assert.Equal(DoctorScopeSet.None, DoctorScopeSet.Parse([]));
    }

    [Fact]
    public void Parse_NullList_IsAnArgumentError()
    {
        Assert.Throws<ArgumentNullException>(() => DoctorScopeSet.Parse(null));
    }

    [Theory]
    [InlineData("bogus")]
    [InlineData("")]
    [InlineData(" growth")]
    [InlineData(null)]
    public void Parse_UnknownOrNullCode_ThrowsValidationOnDoctorScopes(string? code)
    {
        var error = Assert.Throws<DomainValidationException>(() => DoctorScopeSet.Parse(["growth", code]));

        Assert.Equal("doctorScopes", error.Field);
    }

    [Fact]
    public void Equality_IsByContent()
    {
        var first = DoctorScopeSet.Parse(["growth", "notes"]);
        var second = DoctorScopeSet.Parse(["notes", "growth", "notes"]);
        var other = DoctorScopeSet.Parse(["growth"]);

        Assert.Equal(first, second);
        Assert.Equal(first.GetHashCode(), second.GetHashCode());
        Assert.NotEqual(first, other);
        Assert.Equal(DoctorScopeSet.All, DoctorScopeSet.Create(Enum.GetValues<DoctorScope>()));
    }

    [Fact]
    public void Contains_ReportsMembership()
    {
        var set = DoctorScopeSet.Create([DoctorScope.Growth, DoctorScope.Vaccines]);

        Assert.Equal((true, true, false), (set.Contains(DoctorScope.Growth), set.Contains(DoctorScope.Vaccines), set.Contains(DoctorScope.Notes)));
    }

    [Theory]
    [InlineData("daily_log,growth", new[] { "daily_log", "growth" })]
    [InlineData("", new string[0])]
    [InlineData("notes,daily_log", new[] { "daily_log", "notes" })]
    public void Storage_RoundTrips(string stored, string[] codes)
    {
        var set = DoctorScopeSet.FromStorage(stored);

        Assert.Equal(codes, set.Codes);
        Assert.Equal(string.Join(',', codes), set.ToStorage());
        Assert.Equal(set, DoctorScopeSet.FromStorage(set.ToStorage()));
    }

    [Fact]
    public void ToStorage_NoneIsEmptyText_AllFitsTheColumn()
    {
        Assert.Equal(string.Empty, DoctorScopeSet.None.ToStorage());
        Assert.Equal("daily_log,growth,medications,vaccines,formulas,notes", DoctorScopeSet.All.ToStorage());
        Assert.True(DoctorScopeSet.All.ToStorage().Length <= DoctorScopeSet.StorageMaxLength);
    }

    [Fact]
    public void FromStorage_UnknownCodes_AreIgnoredSoAnOlderServerNeverBreaks()
    {
        var set = DoctorScopeSet.FromStorage("growth,future_section, notes ,,");

        Assert.Equal(["growth", "notes"], set.Codes);
        Assert.Equal(DoctorScopeSet.None, DoctorScopeSet.FromStorage(null));
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void Sees_EveryRoleButTheDoctor_SeesEverySection(BabyRole role)
    {
        var baby = NewBaby();
        var member = baby.AddMember(Guid.NewGuid(), role, TestClock.Now);

        Assert.All(Enum.GetValues<DoctorScope>(), scope => Assert.True(member.Sees(scope)));
        Assert.Null(member.DoctorScopes);
    }

    [Fact]
    public void Sees_DoctorWithoutChosenScopes_SeesEverySection()
    {
        var member = NewBaby().AddMember(Guid.NewGuid(), BabyRole.Doctor, TestClock.Now);

        Assert.Null(member.DoctorScopes);
        Assert.Equal(DoctorScopeSet.All, member.EffectiveDoctorScopes);
        Assert.All(Enum.GetValues<DoctorScope>(), scope => Assert.True(member.Sees(scope)));
    }

    [Fact]
    public void Sees_DoctorWithChosenScopes_SeesOnlyThose()
    {
        var baby = NewBaby();
        var doctorId = Guid.NewGuid();
        baby.AddMember(doctorId, BabyRole.Doctor, TestClock.Now);

        var member = baby.ChangeDoctorScopes(doctorId, DoctorScopeSet.Create([DoctorScope.Growth, DoctorScope.Vaccines]));

        Assert.Equal((true, true, false, false, false, false), (member.Sees(DoctorScope.Growth), member.Sees(DoctorScope.Vaccines), member.Sees(DoctorScope.DailyLog), member.Sees(DoctorScope.Medications), member.Sees(DoctorScope.Formulas), member.Sees(DoctorScope.Notes)));
        Assert.Equal(["growth", "vaccines"], member.EffectiveDoctorScopes.Codes);
    }

    [Fact]
    public void Sees_DoctorWithNoScopes_SeesNothing()
    {
        var baby = NewBaby();
        var doctorId = Guid.NewGuid();
        baby.AddMember(doctorId, BabyRole.Doctor, TestClock.Now);

        var member = baby.ChangeDoctorScopes(doctorId, DoctorScopeSet.None);

        Assert.All(Enum.GetValues<DoctorScope>(), scope => Assert.False(member.Sees(scope)));
    }

    [Fact]
    public void AddMember_DoctorWithScopes_KeepsThem()
    {
        var member = NewBaby().AddMember(Guid.NewGuid(), BabyRole.Doctor, TestClock.Now, DoctorScopeSet.Create([DoctorScope.Notes]));

        Assert.Equal(["notes"], member.EffectiveDoctorScopes.Codes);
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void AddMember_ScopesForANonDoctor_ThrowsValidationOnDoctorScopes(BabyRole role)
    {
        var error = Assert.Throws<DomainValidationException>(() => NewBaby().AddMember(Guid.NewGuid(), role, TestClock.Now, DoctorScopeSet.All));

        Assert.Equal("doctorScopes", error.Field);
    }

    [Fact]
    public void Issue_DoctorInviteWithScopes_KeepsThemAndReportsTheEffectiveOnes()
    {
        var issued = Invite.Issue(Guid.NewGuid(), BabyRole.Doctor, OwnerId, TestClock.Now, TimeSpan.FromDays(7), DoctorScopeSet.Create([DoctorScope.DailyLog]));

        Assert.Equal(["daily_log"], issued.Invite.DoctorScopes!.Codes);
        Assert.Equal(["daily_log"], issued.Invite.EffectiveDoctorScopes.Codes);
    }

    [Fact]
    public void Issue_DoctorInviteWithoutScopes_MeansTheDefaults()
    {
        var issued = Invite.Issue(Guid.NewGuid(), BabyRole.Doctor, OwnerId, TestClock.Now, TimeSpan.FromDays(7));

        Assert.Null(issued.Invite.DoctorScopes);
        Assert.Equal(DoctorScopeSet.All, issued.Invite.EffectiveDoctorScopes);
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void Issue_ScopesForANonDoctorInvite_ThrowsValidationOnDoctorScopes(BabyRole role)
    {
        var error = Assert.Throws<DomainValidationException>(() => Invite.Issue(Guid.NewGuid(), role, OwnerId, TestClock.Now, TimeSpan.FromDays(7), DoctorScopeSet.None));

        Assert.Equal("doctorScopes", error.Field);
    }

    [Fact]
    public void AdmitWith_DoctorInviteWithScopes_CopiesThemOntoTheMember()
    {
        var baby = NewBaby();
        var issued = Invite.Issue(baby.Id, BabyRole.Doctor, OwnerId, TestClock.Now, TimeSpan.FromDays(7), DoctorScopeSet.Create([DoctorScope.Growth, DoctorScope.Notes]));

        var member = baby.AdmitWith(issued.Invite, Guid.NewGuid(), TestClock.Now, isDeclaredProfessional: true);

        Assert.Equal(["growth", "notes"], member.DoctorScopes!.Codes);
    }

    [Fact]
    public void AdmitWith_DoctorInviteWithoutScopes_LeavesTheDefaults()
    {
        var baby = NewBaby();
        var issued = Invite.Issue(baby.Id, BabyRole.Doctor, OwnerId, TestClock.Now, TimeSpan.FromDays(7));

        var member = baby.AdmitWith(issued.Invite, Guid.NewGuid(), TestClock.Now, isDeclaredProfessional: true);

        Assert.Null(member.DoctorScopes);
        Assert.Equal(DoctorScopeSet.All, member.EffectiveDoctorScopes);
    }

    [Fact]
    public void ChangeDoctorScopes_UnknownUser_ThrowsMemberNotFound()
    {
        Assert.Throws<MemberNotFoundException>(() => NewBaby().ChangeDoctorScopes(Guid.NewGuid(), DoctorScopeSet.All));
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void ChangeDoctorScopes_MemberWhoIsNotADoctor_ThrowsValidationOnDoctorScopes(BabyRole role)
    {
        var baby = NewBaby();
        var userId = Guid.NewGuid();
        baby.AddMember(userId, role, TestClock.Now);

        var error = Assert.Throws<DomainValidationException>(() => baby.ChangeDoctorScopes(userId, DoctorScopeSet.All));

        Assert.Equal("doctorScopes", error.Field);
    }

    [Fact]
    public void ChangeDoctorScopes_TheOwner_ThrowsValidationOnDoctorScopes()
    {
        var error = Assert.Throws<DomainValidationException>(() => NewBaby().ChangeDoctorScopes(OwnerId, DoctorScopeSet.None));

        Assert.Equal("doctorScopes", error.Field);
    }

    [Fact]
    public void ChangeMemberRole_AwayFromDoctor_ClearsTheScopes()
    {
        var baby = NewBaby();
        var doctorId = Guid.NewGuid();
        baby.AddMember(doctorId, BabyRole.Doctor, TestClock.Now, DoctorScopeSet.Create([DoctorScope.Growth]));

        var member = baby.ChangeMemberRole(doctorId, BabyRole.Viewer);

        Assert.Null(member.DoctorScopes);
        Assert.True(member.Sees(DoctorScope.Notes));
    }

    [Fact]
    public void ChangeMemberRole_BackToDoctor_StartsWithTheDefaultsNotTheOldScopes()
    {
        var baby = NewBaby();
        var userId = Guid.NewGuid();
        baby.AddMember(userId, BabyRole.Doctor, TestClock.Now, DoctorScopeSet.Create([DoctorScope.Growth]));
        baby.ChangeMemberRole(userId, BabyRole.Viewer);

        var member = baby.ChangeMemberRole(userId, BabyRole.Doctor, isDeclaredProfessional: true);

        Assert.Null(member.DoctorScopes);
        Assert.Equal(DoctorScopeSet.All, member.EffectiveDoctorScopes);
    }

    [Fact]
    public void ChangeMemberRole_DoctorStaysDoctor_KeepsHerScopes()
    {
        var baby = NewBaby();
        var doctorId = Guid.NewGuid();
        baby.AddMember(doctorId, BabyRole.Doctor, TestClock.Now, DoctorScopeSet.Create([DoctorScope.Notes]));

        var member = baby.ChangeMemberRole(doctorId, BabyRole.Doctor, isDeclaredProfessional: true);

        Assert.Equal(["notes"], member.DoctorScopes!.Codes);
    }

    [Fact]
    public void DecideScope_NonMember_IsNotMember()
    {
        Assert.Equal(BabyAccessDecision.NotMember, BabyAccess.DecideScope(null, DoctorScope.Growth));
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Caregiver)]
    [InlineData(BabyRole.Viewer)]
    public void DecideScope_AnyRoleButTheDoctor_IsGrantedEvenWithoutAScope(BabyRole role)
    {
        var member = NewBaby().AddMember(Guid.NewGuid(), role, TestClock.Now);

        Assert.Equal((BabyAccessDecision.Granted, BabyAccessDecision.Granted), (BabyAccess.DecideScope(member, DoctorScope.Notes), BabyAccess.DecideScope(member, null)));
    }

    [Fact]
    public void DecideScope_Doctor_NeedsTheScope()
    {
        var baby = NewBaby();
        var doctorId = Guid.NewGuid();
        baby.AddMember(doctorId, BabyRole.Doctor, TestClock.Now);
        var member = baby.ChangeDoctorScopes(doctorId, DoctorScopeSet.Create([DoctorScope.Growth]));

        Assert.Equal(
            (BabyAccessDecision.Granted, BabyAccessDecision.ScopeNotGranted, BabyAccessDecision.ScopeNotGranted),
            (BabyAccess.DecideScope(member, DoctorScope.Growth), BabyAccess.DecideScope(member, DoctorScope.Notes), BabyAccess.DecideScope(member, null)));
    }

    [Fact]
    public void DecideScope_DoctorWithAllScopes_IsStillRefusedARouteWithoutAScope()
    {
        var member = NewBaby().AddMember(Guid.NewGuid(), BabyRole.Doctor, TestClock.Now);

        Assert.Equal(BabyAccessDecision.ScopeNotGranted, BabyAccess.DecideScope(member, null));
    }
}
