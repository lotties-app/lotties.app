using Lotties.Application.Push;
using Lotties.Domain.Notifications;
using Lotties.Infrastructure.Push;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.Push;

public sealed class PushOptionsTests
{
    private static readonly VapidKeyPair Pair = VapidKeys.Generate();
    private readonly PushOptionsValidator _validator = new();

    [Fact]
    public void Validate_NoVapidValues_SucceedsWithPushDisabled()
    {
        var options = new PushOptions();

        var result = _validator.Validate(null, options);

        Assert.True(result.Succeeded);
        Assert.False(options.IsEnabled);
    }

    [Fact]
    public void Validate_GeneratedPair_SucceedsWithPushEnabled()
    {
        var options = Configured(Pair.PublicKey, Pair.PrivateKey, "https://lotties.example.com/contact");

        var result = _validator.Validate(null, options);

        Assert.True(result.Succeeded);
        Assert.True(options.IsEnabled);
    }

    [Theory]
    [InlineData(true, false, false)]
    [InlineData(true, true, false)]
    [InlineData(false, false, true)]
    public void Validate_SomeVapidValuesMissing_Fails(bool hasPublic, bool hasPrivate, bool hasSubject)
    {
        var options = Configured(hasPublic ? Pair.PublicKey : null, hasPrivate ? Pair.PrivateKey : null, hasSubject ? "mailto:ops@example.com" : null);

        var result = _validator.Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains(PushEnvironmentVariables.PrivateKey, result.FailureMessage);
    }

    [Fact]
    public void Validate_PublicKeyOfAnotherPair_FailsWithoutPrintingKeys()
    {
        var options = Configured(VapidKeys.Generate().PublicKey, Pair.PrivateKey, "mailto:ops@example.com");

        var result = _validator.Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains("does not match", result.FailureMessage);
        Assert.DoesNotContain(Pair.PrivateKey, result.FailureMessage);
    }

    [Theory]
    [InlineData("not-a-key", null)]
    [InlineData(null, "c2hvcnQ")]
    public void Validate_MalformedKey_Fails(string? publicKey, string? privateKey)
    {
        var options = Configured(publicKey ?? Pair.PublicKey, privateKey ?? Pair.PrivateKey, "mailto:ops@example.com");

        Assert.True(_validator.Validate(null, options).Failed);
    }

    [Theory]
    [InlineData("ops@example.com")]
    [InlineData("http://example.com")]
    [InlineData("mailto:")]
    public void Validate_InvalidSubject_Fails(string subject)
    {
        Assert.True(_validator.Validate(null, Configured(Pair.PublicKey, Pair.PrivateKey, subject)).Failed);
    }

    [Theory]
    [InlineData(14, 10, 8, 10)]
    [InlineData(301, 10, 8, 10)]
    [InlineData(60, 0, 8, 10)]
    [InlineData(60, 10, 0, 10)]
    [InlineData(60, 10, 8, 0)]
    public void Validate_SettingOutOfRange_Fails(int tickSeconds, int sendTimeoutSeconds, int maxConcurrentSends, int maxSubscriptions)
    {
        var options = new PushOptions
        {
            TickSeconds = tickSeconds,
            SendTimeoutSeconds = sendTimeoutSeconds,
            MaxConcurrentSends = maxConcurrentSends,
            MaxSubscriptionsPerUser = maxSubscriptions,
        };

        Assert.True(_validator.Validate(null, options).Failed);
    }

    [Fact]
    public void Validate_MalformedAllowlistEntry_Fails()
    {
        var options = new PushOptions { AllowedEndpointHosts = ["*.push.example.com", "https://bad/"] };

        Assert.True(_validator.Validate(null, options).Failed);
    }

    [Fact]
    public void EffectiveAllowedEndpointHosts_NoneConfigured_UsesDefaults()
    {
        Assert.Equal(PushEndpointAllowlist.DefaultHosts, new PushOptions().EffectiveAllowedEndpointHosts);
    }

    [Fact]
    public void AddPush_EmptyConfiguration_ResolvesSenderWithPushDisabled()
    {
        using var provider = BuildProvider(new Dictionary<string, string?>());

        var options = provider.GetRequiredService<IOptions<PushOptions>>().Value;

        Assert.False(options.IsEnabled);
        Assert.NotNull(provider.GetRequiredService<IPushSender>());
        Assert.True(provider.GetRequiredService<PushEndpointAllowlist>().Allows(PushEndpoint.From("https://fcm.googleapis.com/fcm/send/x")));
    }

    [Fact]
    public void AddPush_AliasedVapidKeysAndSection_BindsEverything()
    {
        var values = new Dictionary<string, string?>
        {
            [PushEnvironmentVariables.VariableToKey[PushEnvironmentVariables.PublicKey]] = Pair.PublicKey,
            [PushEnvironmentVariables.VariableToKey[PushEnvironmentVariables.PrivateKey]] = Pair.PrivateKey,
            [PushEnvironmentVariables.VariableToKey[PushEnvironmentVariables.Subject]] = "mailto:ops@example.com",
            ["Push:TickSeconds"] = "30",
            ["Push:AllowedEndpointHosts:0"] = "push.example.com",
        };
        using var provider = BuildProvider(values);

        var options = provider.GetRequiredService<IOptions<PushOptions>>().Value;

        Assert.True(options.IsEnabled);
        Assert.Equal(30, options.TickSeconds);
        Assert.Equal(["push.example.com"], options.EffectiveAllowedEndpointHosts);
        Assert.False(provider.GetRequiredService<PushEndpointAllowlist>().Allows(PushEndpoint.From("https://fcm.googleapis.com/fcm/send/x")));
    }

    [Fact]
    public void AddPush_PartialVapidConfiguration_FailsOnFirstUse()
    {
        using var provider = BuildProvider(new Dictionary<string, string?> { ["Push:Vapid:PublicKey"] = Pair.PublicKey });

        Assert.Throws<OptionsValidationException>(() => provider.GetRequiredService<IOptions<PushOptions>>().Value);
    }

    private static PushOptions Configured(string? publicKey, string? privateKey, string? subject) =>
        new() { Vapid = new PushVapidOptions { PublicKey = publicKey, PrivateKey = privateKey, Subject = subject } };

    private static ServiceProvider BuildProvider(Dictionary<string, string?> values)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(values).Build();
        return new ServiceCollection().AddLogging().AddPush(configuration).BuildServiceProvider();
    }
}
