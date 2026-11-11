using System.Text;
using Lotties.Domain.SilentPush;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence.Repositories;
using Lotties.Infrastructure.SilentPush;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Lotties.Infrastructure.Tests.SilentPush;

/// <summary>Startup validation of <c>SilentPush</c>, the configuration it gives the application, and the table's model.</summary>
public sealed class SilentPushOptionsTests : IDisposable
{
    private readonly SilentPushTestKit _kit = SilentPushTestKit.Create();

    public void Dispose() => _kit.Dispose();

    [Fact]
    public void Validate_Defaults_AreValidAndOff()
    {
        var options = new SilentPushOptions();

        Assert.True(Validate(options).Succeeded);
        Assert.False(new SilentPushOptionsConfiguration(Microsoft.Extensions.Options.Options.Create(options)).IsEnabled);
    }

    [Fact]
    public void Validate_BothChannelsConfigured_Succeeds()
    {
        Assert.True(Validate(_kit.Options()).Succeeded);
    }

    [Fact]
    public void Validate_KeysGivenAsBase64_Succeeds()
    {
        var options = _kit.Options();
        options.Apns.PrivateKey = Convert.ToBase64String(Encoding.UTF8.GetBytes(options.Apns.PrivateKey!));
        options.Fcm.ServiceAccountJson = Convert.ToBase64String(Encoding.UTF8.GetBytes(options.Fcm.ServiceAccountJson!));

        Assert.True(Validate(options).Succeeded);
    }

    [Fact]
    public void Validate_EnabledWithoutAChannel_FailsNamingTheSwitch()
    {
        var result = Validate(new SilentPushOptions { Enabled = true });

        Assert.Contains("SILENT_PUSH_ENABLED", result.FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_HalfConfiguredApns_Fails()
    {
        var options = _kit.Options(apns: false);
        options.Apns.KeyId = "ABC123DEFG";

        Assert.Contains("PUSH_APNS_KEY_P8", Validate(options).FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_ApnsKeyThatIsNotP256_FailsWithoutShowingIt()
    {
        var options = _kit.Options();
        options.Apns.PrivateKey = _kit.GoogleKey.ExportPkcs8PrivateKeyPem();

        var message = Validate(options).FailureMessage;

        Assert.Contains("PUSH_APNS_KEY_P8", message, StringComparison.Ordinal);
        Assert.DoesNotContain("PRIVATE KEY", message, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_ServiceAccountWithAnotherTokenHost_Fails()
    {
        var options = _kit.Options();
        options.Fcm.ServiceAccountJson = _kit.ServiceAccountJson("https://attacker.example/token");

        Assert.Contains("token_uri", Validate(options).FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_ServiceAccountThatIsNotJson_Fails()
    {
        var options = _kit.Options();
        options.Fcm.ServiceAccountJson = "not json";

        Assert.Contains("PUSH_FCM_SERVICE_ACCOUNT_JSON", Validate(options).FailureMessage, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(nameof(SilentPushOptions.DebounceSeconds), 301)]
    [InlineData(nameof(SilentPushOptions.MinIntervalSeconds), -1)]
    [InlineData(nameof(SilentPushOptions.WorkerTickSeconds), 0)]
    [InlineData(nameof(SilentPushOptions.MaxDevicesPerUser), 0)]
    [InlineData(nameof(SilentPushOptions.MaxConcurrentSends), 0)]
    public void Validate_OutOfRangeSetting_Fails(string setting, int value)
    {
        var options = new SilentPushOptions();
        typeof(SilentPushOptions).GetProperty(setting)!.SetValue(options, value);

        Assert.Contains(setting, Validate(options).FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_UnknownFcmPriority_Fails()
    {
        Assert.Contains("FcmPriority", Validate(new SilentPushOptions { FcmPriority = "urgent" }).FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Configuration_AcceptsOnlyTheConfiguredChannelsWhileOn()
    {
        var on = new SilentPushOptionsConfiguration(Microsoft.Extensions.Options.Options.Create(_kit.Options(apns: true, fcm: false)));
        var offOptions = _kit.Options();
        offOptions.Enabled = false;
        var off = new SilentPushOptionsConfiguration(Microsoft.Extensions.Options.Options.Create(offOptions));

        Assert.Equal((true, false), (on.Accepts(SilentPushChannel.Apns), on.Accepts(SilentPushChannel.Fcm)));
        Assert.False(off.Accepts(SilentPushChannel.Apns));
        Assert.Equal((TimeSpan.FromSeconds(20), TimeSpan.FromMinutes(5)), (on.Timing.Debounce, on.Timing.MinInterval));
    }

    [Fact]
    public void Channels_WhileOff_HaveNoCredentials()
    {
        var options = _kit.Options();
        options.Enabled = false;

        using var channels = _kit.Channels(options);

        Assert.Equal((null, null), (channels.ApnsToken, channels.FcmToken));
    }

    [Fact]
    public void EnvironmentVariables_MapToTheSection()
    {
        Assert.Equal("SilentPush:Enabled", SilentPushEnvironmentVariables.VariableToKey["SILENT_PUSH_ENABLED"]);
        Assert.Equal("SilentPush:Apns:PrivateKey", SilentPushEnvironmentVariables.VariableToKey["PUSH_APNS_KEY_P8"]);
        Assert.Equal("SilentPush:Fcm:ServiceAccountJson", SilentPushEnvironmentVariables.VariableToKey["PUSH_FCM_SERVICE_ACCOUNT_JSON"]);
    }

    [Fact]
    public void Model_IsUniqueByTokenHashWithAnActiveUserIndexAndCascadeFromUsers()
    {
        using var context = ModelTestContext.Create();
        var device = context.Entity<SilentPushDevice>();

        var unique = device.GetIndexes().Single(index => index.IsUnique);
        var byUser = device.GetIndexes().Single(index => Columns(index.Properties) == "user_id");
        var user = device.GetForeignKeys().Single(key => key.PrincipalEntityType.ClrType == typeof(User));

        Assert.Equal("silent_push_devices", device.GetTableName());
        Assert.Equal("token_hash", Columns(unique.Properties));
        Assert.Equal("revoked_at IS NULL", byUser.GetFilter());
        Assert.Equal(DeleteBehavior.Cascade, user.DeleteBehavior);
        Assert.Equal(512, device.FindProperty(nameof(SilentPushDevice.Token))!.GetMaxLength());
    }

    [Fact]
    public void Model_RecipientsQuery_JoinsMembersAndLeavesOutBabiesOnAnExternalStore()
    {
        using var context = ModelTestContext.Create();

        var sql = EfSilentPushDeviceRepository.RecipientsQuery(context, Guid.NewGuid()).ToQueryString();

        Assert.Contains("INNER JOIN baby_members", sql, StringComparison.Ordinal);
        Assert.Contains("revoked_at IS NULL", sql, StringComparison.Ordinal);
        Assert.Matches(@"NOT\s*\(?\s*EXISTS", sql);
        Assert.Matches(@"\.data_store_id IS NOT NULL", sql);
    }

    private static Microsoft.Extensions.Options.ValidateOptionsResult Validate(SilentPushOptions options) =>
        new SilentPushOptionsValidator().Validate(null, options);

    private static string Columns(IEnumerable<IReadOnlyProperty> properties) =>
        string.Join(',', properties.Select(property => property.GetColumnName()));
}
