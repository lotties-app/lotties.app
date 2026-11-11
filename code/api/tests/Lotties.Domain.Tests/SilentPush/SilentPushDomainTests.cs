using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Notifications;
using Lotties.Domain.SilentPush;

namespace Lotties.Domain.Tests.SilentPush;

/// <summary>Tokens, devices and change batches of the widgets' silent pushes (docs/design/37b-widget-silent-push.md).</summary>
public sealed class SilentPushDomainTests
{
    private static readonly DateTimeOffset Now = TestClock.Now;
    private static readonly Guid MomId = Guid.Parse("8a5c2f1e-2c4b-4d58-9b0e-6f7d2a1c3e4f");
    private static readonly Guid DadId = Guid.Parse("1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9");
    private static readonly Guid BabyId = Guid.Parse("0d6f1c9a-3b2e-4f71-a8c5-9e4d2b1a7c63");
    private static readonly string ApnsToken = new('a', 64);
    private static readonly string FcmToken = "dQw4w9WgXcQ:APA91bH" + new string('x', 140);
    private static readonly SilentPushTiming Timing = new(TimeSpan.FromSeconds(20), TimeSpan.FromMinutes(5));

    private static SilentPushDevice Apns(Guid? userId = null) =>
        SilentPushDevice.Register(userId ?? MomId, SilentPushToken.From(SilentPushChannel.Apns, ApnsToken), ApnsEnvironment.Production, Now);

    [Fact]
    public void Token_From_LowersAnApnsHexTokenAndKeepsAnFcmToken()
    {
        var apns = SilentPushToken.From(SilentPushChannel.Apns, "  " + new string('A', 64) + " ");
        var fcm = SilentPushToken.From(SilentPushChannel.Fcm, FcmToken);

        Assert.Equal(new string('a', 64), apns.Value);
        Assert.Equal(FcmToken, fcm.Value);
        Assert.Equal("[device token]", fcm.ToString());
    }

    [Theory]
    [InlineData(SilentPushChannel.Apns, null)]
    [InlineData(SilentPushChannel.Apns, "abc")]
    [InlineData(SilentPushChannel.Apns, "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")]
    [InlineData(SilentPushChannel.Fcm, "has spaces inside it, which no FCM token has")]
    [InlineData(SilentPushChannel.Fcm, "https://example.com/not/a/token/at/all/x")]
    public void Token_From_RefusesAMalformedToken(SilentPushChannel channel, string? value)
    {
        var error = Assert.Throws<DomainValidationException>(() => SilentPushToken.From(channel, value));

        Assert.Equal("token", error.Field);
    }

    [Fact]
    public void Token_From_RefusesATokenLongerThanTheLimit()
    {
        Assert.Throws<DomainValidationException>(() => SilentPushToken.From(SilentPushChannel.Fcm, new string('x', SilentPushToken.MaxLength + 1)));
    }

    [Fact]
    public void Token_Hash_DependsOnTheChannel()
    {
        var token = new string('a', 64);

        var apns = SilentPushToken.From(SilentPushChannel.Apns, token).Hash;
        var fcm = SilentPushToken.From(SilentPushChannel.Fcm, token).Hash;

        Assert.Equal(43, apns.Length);
        Assert.NotEqual(apns, fcm);
    }

    [Fact]
    public void Register_KeepsTheTokenAndItsHash()
    {
        var device = Apns();

        Assert.Equal((SilentPushChannel.Apns, ApnsToken, ApnsEnvironment.Production), (device.Channel, device.Token, device.ApnsEnvironment));
        Assert.Equal(SilentPushToken.From(SilentPushChannel.Apns, ApnsToken).Hash, device.TokenHash);
        Assert.Equal((Now, Now, 0, false), (device.CreatedAt, device.LastSeenAt, device.ConsecutiveFailures, device.IsRevoked));
    }

    [Fact]
    public void Register_NeedsAnEnvironmentForApnsAndNoneForFcm()
    {
        var apns = Assert.Throws<DomainValidationException>(() => SilentPushDevice.Register(MomId, SilentPushToken.From(SilentPushChannel.Apns, ApnsToken), null, Now));
        var fcm = Assert.Throws<DomainValidationException>(() => SilentPushDevice.Register(MomId, SilentPushToken.From(SilentPushChannel.Fcm, FcmToken), ApnsEnvironment.Sandbox, Now));

        Assert.Equal(("apnsEnvironment", "apnsEnvironment"), (apns.Field, fcm.Field));
    }

    [Fact]
    public void Refresh_ByAnotherUser_MovesTheDeviceUnrevokesItAndClearsFailures()
    {
        var device = Apns();
        device.RecordFailure(Now);
        device.Revoke(SubscriptionRevokeReason.User, Now);

        var transferred = device.Refresh(DadId, ApnsEnvironment.Sandbox, Now.AddMinutes(1));

        Assert.True(transferred);
        Assert.Equal((DadId, ApnsEnvironment.Sandbox, 0, false), (device.UserId, device.ApnsEnvironment, device.ConsecutiveFailures, device.IsRevoked));
        Assert.Equal(Now.AddMinutes(1), device.LastSeenAt);
    }

    [Fact]
    public void Refresh_BySameUser_KeepsTheFailureCount()
    {
        var device = Apns();
        device.RecordFailure(Now);

        Assert.False(device.Refresh(MomId, ApnsEnvironment.Production, Now));
        Assert.Equal(1, device.ConsecutiveFailures);
    }

    [Fact]
    public void Revoke_KeepsTheFirstReason()
    {
        var device = Apns();

        device.Revoke(SubscriptionRevokeReason.Gone, Now);
        device.Revoke(SubscriptionRevokeReason.User, Now.AddMinutes(1));

        Assert.Equal((SubscriptionRevokeReason.Gone, Now), (device.RevokedReason, device.RevokedAt));
    }

    [Theory]
    [InlineData(SilentPushOutcome.Gone, SubscriptionRevokeReason.Gone)]
    [InlineData(SilentPushOutcome.Invalid, SubscriptionRevokeReason.Invalid)]
    public void RecordOutcome_GoneOrInvalid_RevokesTheDevice(SilentPushOutcome outcome, SubscriptionRevokeReason reason)
    {
        var device = Apns();

        device.RecordOutcome(outcome, Now);

        Assert.Equal(reason, device.RevokedReason);
    }

    [Fact]
    public void RecordOutcome_Sent_RecordsTheTimeAndClearsFailures()
    {
        var device = Apns();
        device.RecordOutcome(SilentPushOutcome.Failed, Now);

        device.RecordOutcome(SilentPushOutcome.Sent, Now.AddMinutes(1));

        Assert.Equal((Now.AddMinutes(1), 0), (device.LastSentAt, device.ConsecutiveFailures));
    }

    [Theory]
    [InlineData(SilentPushOutcome.Retryable)]
    [InlineData(SilentPushOutcome.ConfigurationError)]
    [InlineData(SilentPushOutcome.NotConfigured)]
    public void RecordOutcome_NotTheDevicesFault_ChangesNothing(SilentPushOutcome outcome)
    {
        var device = Apns();

        device.RecordOutcome(outcome, Now);

        Assert.Equal((0, false, (DateTimeOffset?)null), (device.ConsecutiveFailures, device.IsRevoked, device.LastSentAt));
    }

    [Fact]
    public void RecordOutcome_TenFailuresInARow_RevokesAsInvalid()
    {
        var device = Apns();

        for (var attempt = 0; attempt < SilentPushRules.MaxConsecutiveFailures; attempt++)
        {
            device.RecordOutcome(SilentPushOutcome.Failed, Now);
        }

        Assert.Equal(SubscriptionRevokeReason.Invalid, device.RevokedReason);
    }

    [Fact]
    public void BeyondCap_ReturnsTheLeastRecentlySeen()
    {
        var old = Apns();
        var recent = SilentPushDevice.Register(MomId, SilentPushToken.From(SilentPushChannel.Fcm, FcmToken), null, Now.AddDays(1));

        var beyond = SilentPushDevice.BeyondCap([old, recent], 1);

        Assert.Equal([old], beyond);
    }

    [Theory]
    [InlineData(BabyRole.Owner, true)]
    [InlineData(BabyRole.Parent, true)]
    [InlineData(BabyRole.Caregiver, true)]
    [InlineData(BabyRole.Viewer, true)]
    [InlineData(BabyRole.Doctor, false)]
    public void CanReceive_EveryRoleButDoctor(BabyRole role, bool expected)
    {
        Assert.Equal(expected, SilentPushRules.CanReceive(role));
    }

    [Fact]
    public void Batch_DueAt_IsTheDebounceAfterTheFirstChange()
    {
        var batch = BabyChangeBatch.Start(BabyId, new SilentPushOrigin(MomId, null), Now);

        Assert.Equal(Now.AddSeconds(20), batch.DueAt(null, Timing));
    }

    [Fact]
    public void Batch_DueAt_WaitsForTheIntervalAfterThePreviousPush()
    {
        var batch = BabyChangeBatch.Start(BabyId, new SilentPushOrigin(MomId, null), Now);

        Assert.Equal(Now.AddMinutes(4), batch.DueAt(Now.AddMinutes(-1), Timing));
        Assert.Equal(Now.AddSeconds(20), batch.DueAt(Now.AddMinutes(-10), Timing));
    }

    [Fact]
    public void Batch_FromOneDevice_SkipsThatDeviceOnly()
    {
        var mine = Apns();
        var other = Apns(DadId);
        var batch = BabyChangeBatch.Start(BabyId, new SilentPushOrigin(MomId, mine.Id), Now).With(new SilentPushOrigin(MomId, mine.Id));

        Assert.True(batch.Skips(mine));
        Assert.False(batch.Skips(other));
    }

    [Fact]
    public void Batch_FromTwoOrigins_SkipsNoDevice()
    {
        var mine = Apns();
        var batch = BabyChangeBatch.Start(BabyId, new SilentPushOrigin(MomId, mine.Id), Now).With(new SilentPushOrigin(DadId, null));

        Assert.Null(batch.SoleOrigin);
        Assert.False(batch.Skips(mine));
        Assert.Equal(Now, batch.FirstChangeAt);
    }

    [Fact]
    public void Batch_SkipsADeviceOnlyForItsOwnUser()
    {
        var dads = Apns(DadId);
        var batch = BabyChangeBatch.Start(BabyId, new SilentPushOrigin(MomId, dads.Id), Now);

        Assert.False(batch.Skips(dads));
    }

    [Fact]
    public void Batch_WithoutADevice_SkipsNothing()
    {
        var mine = Apns();
        var batch = BabyChangeBatch.Start(BabyId, new SilentPushOrigin(MomId, null), Now);

        Assert.False(batch.Skips(mine));
    }

    [Fact]
    public void Codes_RoundTrip()
    {
        Assert.True(SilentPushCodes.TryParse("apns", out SilentPushChannel apns));
        Assert.True(SilentPushCodes.TryParse("sandbox", out ApnsEnvironment sandbox));
        Assert.False(SilentPushCodes.TryParse("APNS", out SilentPushChannel _));
        Assert.False(SilentPushCodes.TryParse((string?)null, out ApnsEnvironment _));
        Assert.Equal(("apns", "sandbox", "fcm"), (SilentPushCodes.Of(apns), SilentPushCodes.Of(sandbox), SilentPushCodes.Of(SilentPushChannel.Fcm)));
    }
}
