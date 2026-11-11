using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The community insights consent rules (docs/design/34-community-insights.md section 3, task T2): who decides, what a yes needs,
/// what the latest line means, and that withdrawal wins at once.
/// </summary>
public sealed class CommunityConsentTests
{
    private const string Policy = "9";

    private static readonly Guid Baby = Guid.Parse("3b6adcb0-0000-4000-8000-000000000001");
    private static readonly Guid Ana = Guid.Parse("3b6adcb0-0000-4000-8000-000000000002");
    private static readonly Guid Bruno = Guid.Parse("3b6adcb0-0000-4000-8000-000000000003");
    private static readonly DateTimeOffset Now = new(2026, 11, 3, 9, 0, 0, TimeSpan.Zero);

    private static CommunityConsentEntry Yes(Guid user, DateTimeOffset at) =>
        CommunityConsentEntry.Grant(Baby, user, CommunityConsentTexts.CurrentTextVersion, guardianConfirmed: true, Policy, "pt-BR", at);

    private static CommunityConsentEntry No(Guid user, DateTimeOffset at) => CommunityConsentEntry.Withdraw(Baby, user, Policy, "en", at);

    private static CommunityConsentEntry OldYes(DateTimeOffset at) =>
        CommunityConsentEntry.Rehydrate(Guid.NewGuid(), Baby, Ana, CommunityConsentAction.Granted, "ci-0", Policy, ["all"], guardianConfirmed: true, "en", at);

    [Theory]
    [InlineData(BabyRole.Owner, true)]
    [InlineData(BabyRole.Parent, true)]
    [InlineData(BabyRole.Caregiver, false)]
    [InlineData(BabyRole.Viewer, false)]
    [InlineData(BabyRole.Doctor, false)]
    public void MayDecide_OnlyOwnerAndParent(BabyRole role, bool expected)
    {
        Assert.Equal(expected, CommunityConsentRules.MayDecide(role));
    }

    [Fact]
    public void Grant_RecordsTheTextPolicyPurposesDeclarationLocaleAndTime()
    {
        var entry = CommunityConsentEntry.Grant(Baby, Ana, "ci-1", guardianConfirmed: true, Policy, "pt-BR", Now.AddTicks(7));

        Assert.Equal((Baby, Ana, CommunityConsentAction.Granted, "ci-1", Policy, true, "pt-BR"), (entry.BabyId, entry.UserId, entry.Action, entry.TextVersion, entry.PolicyVersion, entry.GuardianConfirmed, entry.Locale));
        Assert.Equal(["all"], entry.Scopes);
        Assert.Equal(Now, entry.At);
        Assert.NotEqual(Guid.Empty, entry.Id);
    }

    [Fact]
    public void Grant_WithoutTheGuardianDeclaration_IsRefused()
    {
        var error = Assert.Throws<DomainValidationException>(() => CommunityConsentEntry.Grant(Baby, Ana, "ci-1", guardianConfirmed: false, Policy, "en", Now));

        Assert.Equal("guardianConfirmed", error.Field);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Grant_WithoutATextVersion_IsAValidationError(string? textVersion)
    {
        var error = Assert.Throws<DomainValidationException>(() => CommunityConsentEntry.Grant(Baby, Ana, textVersion, guardianConfirmed: true, Policy, "en", Now));

        Assert.Equal("textVersion", error.Field);
    }

    [Fact]
    public void Grant_ForAnOlderText_IsOutdated()
    {
        var error = Assert.Throws<CommunityConsentVersionOutdatedException>(() => CommunityConsentEntry.Grant(Baby, Ana, "ci-0", guardianConfirmed: true, Policy, "en", Now));

        Assert.Equal("community_consent_version_outdated", error.Code);
        Assert.Equal("ci-1", error.Details["currentTextVersion"]);
    }

    [Fact]
    public void Withdraw_NeedsNoDeclarationAndHasNoPurpose()
    {
        var entry = No(Bruno, Now);

        Assert.Equal((CommunityConsentAction.Withdrawn, false, "ci-1"), (entry.Action, entry.GuardianConfirmed, entry.TextVersion));
        Assert.Empty(entry.Scopes);
    }

    [Fact]
    public void Entry_UnknownLocale_IsKeptAsUnknown()
    {
        Assert.Equal("und", CommunityConsentEntry.Withdraw(Baby, Ana, Policy, "<script>", Now).Locale);
    }

    [Fact]
    public void History_Empty_IsNoneAndNotInForce()
    {
        var history = CommunityConsentHistory.Of([]);

        Assert.Equal((CommunityConsentStatus.None, false, null), (history.Status, history.IsInForce, history.Latest));
    }

    [Fact]
    public void History_LatestLineDecides_WithdrawalWinsAtOnce()
    {
        var yes = Yes(Ana, Now);
        var no = No(Bruno, Now.AddMinutes(1));

        var history = CommunityConsentHistory.Of([no, yes]);

        Assert.Equal([yes, no], history.Entries);
        Assert.Equal((CommunityConsentStatus.Off, false), (history.Status, history.IsInForce));
        Assert.True(CommunityConsentHistory.Of([yes]).IsInForce);
    }

    [Fact]
    public void History_YesUnderAnOlderText_NeedsRenewalAndIsNotInForce()
    {
        var history = CommunityConsentHistory.Of([OldYes(Now)]);

        Assert.Equal((CommunityConsentStatus.RenewalNeeded, false), (history.Status, history.IsInForce));
    }

    [Fact]
    public void Change_YesWhenNotOn_AddsAGrant()
    {
        var change = CommunityConsentHistory.Of([No(Bruno, Now)]).Change(true, Baby, Ana, "ci-1", guardianConfirmed: true, Policy, "en", Now.AddHours(1));

        Assert.Equal(CommunityConsentAction.Granted, change!.Action);
        Assert.Equal(Ana, change.UserId);
    }

    [Fact]
    public void Change_YesWhileOn_RecordsNothing_ButAnOldScreenIsStillRefused()
    {
        var history = CommunityConsentHistory.Of([Yes(Ana, Now)]);

        Assert.Null(history.Change(true, Baby, Bruno, "ci-1", guardianConfirmed: true, Policy, "en", Now.AddHours(1)));
        Assert.Throws<CommunityConsentVersionOutdatedException>(() => history.Change(true, Baby, Bruno, "ci-0", guardianConfirmed: true, Policy, "en", Now.AddHours(1)));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Change_NoWhenNotOn_RecordsNothing(bool alreadyWithdrawn)
    {
        CommunityConsentEntry[] entries = alreadyWithdrawn ? [No(Ana, Now)] : [];
        var history = CommunityConsentHistory.Of(entries);

        Assert.Null(history.Change(false, Baby, Bruno, null, guardianConfirmed: false, Policy, "en", Now.AddHours(1)));
    }

    [Fact]
    public void Change_NoWhileOnOrPendingRenewal_AddsAWithdrawal()
    {
        var fromOn = CommunityConsentHistory.Of([Yes(Ana, Now)]).Change(false, Baby, Bruno, null, guardianConfirmed: false, Policy, "en", Now.AddHours(1));
        var fromRenewal = CommunityConsentHistory.Of([OldYes(Now)]).Change(false, Baby, Bruno, null, guardianConfirmed: false, Policy, "en", Now.AddHours(1));

        Assert.Equal((CommunityConsentAction.Withdrawn, Bruno), (fromOn!.Action, fromOn.UserId));
        Assert.Equal(CommunityConsentAction.Withdrawn, fromRenewal!.Action);
    }

    [Fact]
    public void Change_YesNeedsTheDeclarationAndTheCurrentText()
    {
        var history = CommunityConsentHistory.Of([]);

        Assert.Throws<DomainValidationException>(() => history.Change(true, Baby, Ana, "ci-1", guardianConfirmed: false, Policy, "en", Now));
        Assert.Throws<CommunityConsentVersionOutdatedException>(() => history.Change(true, Baby, Ana, "ci-0", guardianConfirmed: true, Policy, "en", Now));
    }

    [Fact]
    public void Change_AtTheSameInstantAsTheLatestLine_IsStillTheLatestAfterwards()
    {
        var yes = Yes(Ana, Now);
        var history = CommunityConsentHistory.Of([yes]);

        var no = history.Change(false, Baby, Bruno, null, guardianConfirmed: false, Policy, "en", Now.AddSeconds(-5))!;

        Assert.True(no.At > yes.At);
        Assert.Same(no, CommunityConsentHistory.Of([no, yes]).Latest);
        Assert.Equal(CommunityConsentStatus.Off, CommunityConsentHistory.Of([yes, no]).Status);
    }
}
