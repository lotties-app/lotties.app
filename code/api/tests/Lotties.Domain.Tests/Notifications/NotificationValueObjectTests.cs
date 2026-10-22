using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Notifications;
using static Lotties.Domain.Tests.Notifications.NotificationFixtures;

namespace Lotties.Domain.Tests.Notifications;

public sealed class NotificationValueObjectTests
{
    private static readonly Guid Id = Guid.Parse("0f8fad5b-d9cb-469f-a165-70867728950e");

    [Fact]
    public void NotificationKey_Builders_UseUtcMinutesAndCompactIds()
    {
        var slot = new DateTimeOffset(2026, 10, 21, 18, 0, 0, TimeSpan.FromHours(-3));

        Assert.Equal("dose:0f8fad5bd9cb469fa16570867728950e:202610212100", NotificationKey.ForDose(Id, slot).Value);
        Assert.Equal("nap:0f8fad5bd9cb469fa16570867728950e:202610212100", NotificationKey.ForNap(Id, slot).Value);
        Assert.Equal("test:0f8fad5bd9cb469fa16570867728950e", NotificationKey.ForTest(Id).Value);
        Assert.Equal("overtired:0f8fad5bd9cb469fa16570867728950e:202610212100", NotificationKey.ForOvertired(Id, slot).Value);
        Assert.Equal("fussy:0f8fad5bd9cb469fa16570867728950e:20261021", NotificationKey.ForFussy(Id, new DateOnly(2026, 10, 21)).Value);
    }

    [Fact]
    public void NotificationKey_Snoozed_AppendsTheNumberAndKeepsTheBase()
    {
        var key = NotificationKey.ForDose(Id, TestClock.Now);

        var resend = key.Snoozed(2);

        Assert.Equal($"{key.Value}:s2", resend.Value);
        Assert.True(resend.IsSnoozeResend);
        Assert.Equal(key, resend.Base);
        Assert.Equal(key.Snoozed(3), resend.Snoozed(3));
        Assert.Throws<ArgumentOutOfRangeException>(() => key.Snoozed(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => key.Snoozed(4));
    }

    [Theory]
    [InlineData("dose:0f8fad5bd9cb469fa16570867728950e:202610212100", true)]
    [InlineData("nap:0f8fad5bd9cb469fa16570867728950e:202610212100:s3", true)]
    [InlineData("test:0f8fad5bd9cb469fa16570867728950e", true)]
    [InlineData("overtired:0f8fad5bd9cb469fa16570867728950e:202610212100", true)]
    [InlineData("overtired:0f8fad5bd9cb469fa16570867728950e:202610212100:s1", true)]
    [InlineData("fussy:0f8fad5bd9cb469fa16570867728950e:20261021", true)]
    [InlineData("fussy:0f8fad5bd9cb469fa16570867728950e:202610212100", false)]
    [InlineData("overtired:0f8fad5bd9cb469fa16570867728950e:20261021", false)]
    [InlineData("dose:0f8fad5bd9cb469fa16570867728950e", false)]
    [InlineData("test:0f8fad5bd9cb469fa16570867728950e:202610212100", false)]
    [InlineData("dose:0F8FAD5BD9CB469FA16570867728950E:202610212100", false)]
    [InlineData("feed:0f8fad5bd9cb469fa16570867728950e:202610212100", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void NotificationKey_TryFrom_AcceptsOnlyKnownShapes(string? value, bool expected)
    {
        Assert.Equal(expected, NotificationKey.TryFrom(value, out _));
    }

    [Fact]
    public void NotificationKey_From_Malformed_ThrowsValidation()
    {
        Assert.Equal("key", Assert.Throws<DomainValidationException>(() => NotificationKey.From("x")).Field);
    }

    [Theory]
    [InlineData(22, 0, true)]
    [InlineData(23, 59, true)]
    [InlineData(0, 0, true)]
    [InlineData(6, 59, true)]
    [InlineData(7, 0, false)]
    [InlineData(21, 59, false)]
    [InlineData(12, 0, false)]
    public void QuietHours_AcrossMidnight_StartInclusiveEndExclusive(int hour, int minute, bool expected)
    {
        var local = new DateTimeOffset(2026, 3, 2, hour, minute, 0, SaoPaulo);

        Assert.Equal(expected, QuietHours.Default.Contains(local, SaoPaulo));
    }

    [Fact]
    public void QuietHours_EvaluatedInTheGivenOffset()
    {
        var instant = new DateTimeOffset(2026, 3, 2, 1, 0, 0, TimeSpan.Zero);

        Assert.True(QuietHours.Default.Contains(instant, SaoPaulo));
        Assert.False(QuietHours.Default.Contains(instant, TimeSpan.FromHours(9)));
    }

    [Fact]
    public void QuietHours_SameDayRangeAndDisabled()
    {
        var afternoon = QuietHours.Create(true, new TimeOnly(13, 0), new TimeOnly(15, 0));
        var off = QuietHours.Create(false, new TimeOnly(13, 0), new TimeOnly(15, 0));

        Assert.True(afternoon.Contains(At(14), SaoPaulo));
        Assert.False(afternoon.Contains(At(15), SaoPaulo));
        Assert.False(afternoon.Contains(At(23), SaoPaulo));
        Assert.False(off.Contains(At(14), SaoPaulo));
    }

    [Fact]
    public void QuietHours_EqualTimes_Rejected()
    {
        Assert.Equal("quietHours.end", Assert.Throws<DomainValidationException>(() => QuietHours.Create(true, new TimeOnly(7, 0), new TimeOnly(7, 0))).Field);
    }

    [Fact]
    public void ReminderPreferences_DefaultIsAllOffButAppointmentsWithTenMinuteNapLead()
    {
        Assert.Equal((false, 0, false, 10, true), (ReminderPreferences.Default.DoseDue, ReminderPreferences.Default.DoseLeadMinutes, ReminderPreferences.Default.NapWindow, ReminderPreferences.Default.NapLeadMinutes, ReminderPreferences.Default.WantsAny));
        Assert.True(ReminderPreferences.Default.AppointmentReminders);
        Assert.Equal((false, false), (ReminderPreferences.None.AppointmentReminders, ReminderPreferences.None.WantsAny));
        Assert.False(ReminderPreferences.Default.BellyPainPattern);
        Assert.Equal((false, false, false), (ReminderPreferences.Default.OvertiredWarning, ReminderPreferences.Default.FussyPattern, ReminderPreferences.Default.WantsEventHistory));
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void ReminderPreferences_OvertiredOrFussyAlone_MakesTheBabyACandidateThatNeedsTheEvents(bool overtired, bool fussy)
    {
        var preferences = ReminderPreferences.Create(false, 0, false, 10, overtiredWarning: overtired, fussyPattern: fussy);

        Assert.Equal((overtired, fussy, true, true), (preferences.OvertiredWarning, preferences.FussyPattern, preferences.WantsAny, preferences.WantsEventHistory));
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void ReminderPreferences_ADiaperHeadsUpAlone_MakesTheBabyACandidateThatNeedsTheEvents(bool wet, bool dirty)
    {
        var preferences = ReminderPreferences.Create(false, 0, false, 10, diaperWetHeadsUp: wet, diaperDirtyHeadsUp: dirty);

        Assert.Equal((wet, dirty, true, true, true), (preferences.DiaperWetHeadsUp, preferences.DiaperDirtyHeadsUp, preferences.WantsAny, preferences.WantsEventHistory, preferences.WantsDiapers));
        Assert.Equal((false, false, false), (ReminderPreferences.Default.DiaperWetHeadsUp, ReminderPreferences.Default.DiaperDirtyHeadsUp, ReminderPreferences.Default.WantsDiapers));
    }

    [Fact]
    public void ReminderPreferences_With_MergesTheDiaperHeadsUpsAndKeepsTheRest()
    {
        var stored = ReminderPreferences.Create(true, 5, false, 10, fussyPattern: true, diaperDirtyHeadsUp: true);

        var wetOn = stored.With(new ReminderPreferencesChange(DiaperWetHeadsUp: true));
        var olderClient = wetOn.With(new ReminderPreferencesChange(DoseDue: false, FussyPattern: false));

        Assert.Equal(ReminderPreferences.Create(true, 5, false, 10, fussyPattern: true, diaperWetHeadsUp: true, diaperDirtyHeadsUp: true), wetOn);
        Assert.Equal((true, true), (olderClient.DiaperWetHeadsUp, olderClient.DiaperDirtyHeadsUp));
    }

    [Fact]
    public void ReminderPreferences_DoseOnly_DoesNotNeedTheEvents()
    {
        Assert.False(ReminderPreferences.Create(true, 5, false, 10).WantsEventHistory);
    }

    [Fact]
    public void ReminderPreferences_With_ChangesOnlyTheNamedValues()
    {
        var stored = ReminderPreferences.Create(true, 15, true, 20, bellyPainPattern: true, overtiredWarning: true, fussyPattern: true);

        var unchanged = stored.With(new ReminderPreferencesChange());
        var napOff = stored.With(new ReminderPreferencesChange(NapWindow: false));
        var fussyOff = stored.With(new ReminderPreferencesChange(FussyPattern: false, DoseLeadMinutes: 0));

        Assert.Equal(stored, unchanged);
        Assert.Equal(ReminderPreferences.Create(true, 15, false, 20, true, true, true), napOff);
        Assert.Equal(ReminderPreferences.Create(true, 0, true, 20, true, true, false), fussyOff);
    }

    [Fact]
    public void ReminderPreferences_With_ValidatesTheMergedLeads()
    {
        var change = new ReminderPreferencesChange(NapLeadMinutes: 7);

        Assert.Equal("napLeadMinutes", Assert.Throws<DomainValidationException>(() => ReminderPreferences.Default.With(change)).Field);
    }

    [Fact]
    public void ReminderPreferences_BellyPainPatternAlone_MakesTheBabyACandidate()
    {
        var preferences = ReminderPreferences.Create(false, 0, false, 10, bellyPainPattern: true);

        Assert.True(preferences.BellyPainPattern);
        Assert.True(preferences.WantsAny);
        Assert.NotEqual(ReminderPreferences.Create(false, 0, false, 10), preferences);
    }

    [Theory]
    [InlineData(5, 20, null)]
    [InlineData(15, 0, null)]
    [InlineData(10, 10, "doseLeadMinutes")]
    [InlineData(0, 5, "napLeadMinutes")]
    [InlineData(-5, 10, "doseLeadMinutes")]
    public void ReminderPreferences_Create_AcceptsOnlyTheLeadOptions(int doseLead, int napLead, string? failingField)
    {
        var create = () => ReminderPreferences.Create(true, doseLead, true, napLead);

        if (failingField is null)
        {
            Assert.Equal(TimeSpan.FromMinutes(doseLead), create().DoseLead);
            return;
        }

        Assert.Equal(failingField, Assert.Throws<DomainValidationException>(() => create()).Field);
    }

    [Fact]
    public void NotificationTimeZone_KnownIanaId_IsAcceptedWithDaylightSavingOffsets()
    {
        var zone = NotificationTimeZone.From(" America/New_York ");

        Assert.Equal("America/New_York", zone.Value);
        Assert.Equal(TimeSpan.FromHours(-5), zone.OffsetAt(new DateTimeOffset(2026, 1, 15, 12, 0, 0, TimeSpan.Zero)));
        Assert.Equal(TimeSpan.FromHours(-4), zone.OffsetAt(new DateTimeOffset(2026, 7, 15, 12, 0, 0, TimeSpan.Zero)));
        Assert.Equal(TimeSpan.FromHours(-3), NotificationTimeZone.From("America/Sao_Paulo").OffsetAt(TestClock.Now));
    }

    [Theory]
    [InlineData("Mars/Olympus_Mons")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("America/New_York\0")]
    public void NotificationTimeZone_UnknownOrMalformed_Rejected(string? value)
    {
        Assert.Equal("timeZone", Assert.Throws<DomainValidationException>(() => NotificationTimeZone.From(value)).Field);
    }

    [Theory]
    [InlineData("pt-BR", "pt-BR")]
    [InlineData("pt-br", "pt-BR")]
    [InlineData("en", "en")]
    [InlineData("fr", "en")]
    [InlineData(null, "en")]
    public void NotificationLocale_UnknownBecomesEnglish(string? value, string expected)
    {
        Assert.Equal(expected, NotificationLocale.FromOrDefault(value).Value);
    }

    [Fact]
    public void PushEndpoint_HttpsUrl_IsAcceptedAndHashedAsBase64Url()
    {
        var endpoint = FcmEndpoint();

        Assert.Equal("fcm.googleapis.com", endpoint.Host);
        Assert.Equal(43, endpoint.Hash.Length);
        Assert.Matches("^[A-Za-z0-9_-]{43}$", endpoint.Hash);
        Assert.Equal(PushEndpoint.HashOf(endpoint.Value), endpoint.Hash);
        Assert.NotEqual(FcmEndpoint("other").Hash, endpoint.Hash);
        Assert.DoesNotContain("fcm", endpoint.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("http://fcm.googleapis.com/fcm/send/x")]
    [InlineData("https://fcm.googleapis.com:8443/fcm/send/x")]
    [InlineData("https://user:pass@fcm.googleapis.com/fcm/send/x")]
    [InlineData("https://127.0.0.1/send/x")]
    [InlineData("/fcm/send/x")]
    [InlineData("")]
    [InlineData(null)]
    public void PushEndpoint_NotAnHttpsHostUrl_Rejected(string? value)
    {
        Assert.Equal("endpoint", Assert.Throws<DomainValidationException>(() => PushEndpoint.From(value)).Field);
    }

    [Fact]
    public void PushEndpoint_TooLong_Rejected()
    {
        var value = "https://fcm.googleapis.com/" + new string('a', PushEndpoint.MaxLength);

        Assert.Throws<DomainValidationException>(() => PushEndpoint.From(value));
    }

    [Theory]
    [InlineData("https://fcm.googleapis.com/fcm/send/x", true)]
    [InlineData("https://updates.push.services.mozilla.com/wpush/v2/x", true)]
    [InlineData("https://web.push.apple.com/x", true)]
    [InlineData("https://api.push.apple.com/x", true)]
    [InlineData("https://db5p.notify.windows.com/w/?token=x", true)]
    [InlineData("https://push.apple.com/x", false)]
    [InlineData("https://evil-push.apple.com.example.org/x", false)]
    [InlineData("https://internal.example.org/x", false)]
    public void PushEndpointAllowlist_Default_KnownPushServicesOnly(string url, bool allowed)
    {
        var endpoint = PushEndpoint.From(url);

        Assert.Equal(allowed, PushEndpointAllowlist.Default.Allows(endpoint));
    }

    [Fact]
    public void PushEndpointAllowlist_EnsureAllows_UnknownHostThrows422Code()
    {
        var allowlist = PushEndpointAllowlist.Create(["push.example.org"]);

        Assert.Equal(FcmEndpoint("x").Value, PushEndpointAllowlist.Default.EnsureAllows(FcmEndpoint("x")).Value);
        Assert.Equal("push_endpoint_not_allowed", Assert.Throws<PushEndpointNotAllowedException>(() => allowlist.EnsureAllows(FcmEndpoint())).Code);
    }

    [Theory]
    [InlineData("")]
    [InlineData("*")]
    [InlineData("*.*.example.org")]
    [InlineData("https://example.org")]
    public void PushEndpointAllowlist_InvalidEntry_Throws(string entry)
    {
        Assert.Throws<ArgumentException>(() => PushEndpointAllowlist.Create([entry]));
    }

    [Fact]
    public void PushKeys_WellFormed_Accepted()
    {
        var keys = PushKeys.Create(P256dh(), Auth());

        Assert.Equal((P256dh(), Auth()), (keys.P256dh, keys.Auth));
        Assert.Equal(87, keys.P256dh.Length);
    }

    [Fact]
    public void PushKeys_WrongSizesPrefixOrAlphabet_Rejected()
    {
        Assert.Equal("keys.p256dh", Assert.Throws<DomainValidationException>(() => PushKeys.Create(P256dh(prefix: 0x02), Auth())).Field);
        Assert.Equal("keys.p256dh", Assert.Throws<DomainValidationException>(() => PushKeys.Create("not+base64/url", Auth())).Field);
        Assert.Equal("keys.auth", Assert.Throws<DomainValidationException>(() => PushKeys.Create(P256dh(), Auth(15))).Field);
        Assert.Equal("keys.auth", Assert.Throws<DomainValidationException>(() => PushKeys.Create(P256dh(), null)).Field);
    }

    [Fact]
    public void NotificationActionToken_GeneratedHashIs43CharactersAndComparesInConstantTime()
    {
        var token = NotificationActionToken.Generate();

        Assert.Equal(43, token.Value.Length);
        Assert.Equal(43, token.Hash().Value.Length);
        Assert.True(token.Hash().FixedTimeEquals(token.Hash()));
        Assert.False(token.Hash().FixedTimeEquals(NotificationActionToken.Generate().Hash()));
        Assert.False(NotificationActionToken.TryFrom("short", out _));
    }

    [Fact]
    public void NotificationNames_TrimmedTo40Characters()
    {
        var names = NotificationNames.Create(new string('b', 45), "  Simeticona  ");

        Assert.Equal((new string('b', 40), "Simeticona"), (names.Baby, names.Medication));
    }

    [Fact]
    public void NotificationRules_OnlyMembersWhoLogReceive()
    {
        Assert.Equal([true, true, true, false], new[] { BabyRole.Owner, BabyRole.Parent, BabyRole.Caregiver, BabyRole.Viewer }.Select(NotificationRules.CanReceive));
    }

    [Fact]
    public void NotificationCodes_RoundTripEveryValue()
    {
        AssertRoundTrip<NotificationKind>(["dose_due", "nap_window", "test", "belly_pain_pattern", "overtired_warning", "fussy_pattern", "diaper_wet_headsup", "diaper_dirty_headsup", "appointment_reminder"]);
        AssertRoundTrip<NotificationUrgency>(["normal", "high"]);
        AssertRoundTrip<NotificationSkipReason>(["stale", "quiet_hours", "unavailable", "limit", "snoozed", "dismissed", "spacing", "daily_cap"]);
        AssertRoundTrip<DeliveryStatus>(["pending", "sent", "failed", "expired", "gone", "cancelled"]);
        AssertRoundTrip<SubscriptionRevokeReason>(["user", "gone", "invalid", "inactive", "transferred"]);
        AssertRoundTrip<NotificationActionKind>(["snoozed", "dismissed"]);
        Assert.False(NotificationCodes.TryParse<NotificationKind>("DoseDue", out _));
        Assert.False(NotificationCodes.TryParse<NotificationKind>(null, out _));
    }

    private static void AssertRoundTrip<TEnum>(string[] codes)
        where TEnum : struct, Enum
    {
        var parsed = codes.Select(code => NotificationCodes.TryParse<TEnum>(code, out var value) ? value : throw new Xunit.Sdk.XunitException($"{code} did not parse")).ToArray();
        Assert.Equal(Enum.GetValues<TEnum>(), parsed);
    }
}
