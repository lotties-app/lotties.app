using Lotties.Application.Stores;
using Lotties.Infrastructure.Stores;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using static Lotties.Infrastructure.Tests.Stores.StoreTestKit;

namespace Lotties.Infrastructure.Tests.Stores;

public sealed class StoreCredentialsOptionsTests
{
    private readonly StoreCredentialsOptionsValidator _validator = new();

    [Fact]
    public void Validate_DisabledWithoutKeys_Succeeds()
    {
        Assert.True(_validator.Validate(null, new StoreCredentialsOptions()).Succeeded);
    }

    [Fact]
    public void Validate_EnabledWithAValidKey_Succeeds()
    {
        Assert.True(_validator.Validate(null, Options("k1", ("k1", RandomKey()), ("old-2025", RandomKey()))).Succeeded);
    }

    [Fact]
    public void Validate_EnabledWithoutCurrentKeyId_Fails()
    {
        var result = _validator.Validate(null, Options(" ", ("k1", RandomKey())));

        Assert.True(result.Failed);
        Assert.Contains("Stores:CurrentKeyId is required", result.FailureMessage);
    }

    [Fact]
    public void Validate_CurrentKeyIdNotConfigured_Fails()
    {
        var result = _validator.Validate(null, Options("k2", ("k1", RandomKey())));

        Assert.True(result.Failed);
        Assert.Contains("'k2' must name one of", result.FailureMessage);
    }

    [Theory]
    [InlineData("not base64!")]
    [InlineData("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHg==")]
    [InlineData("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8g")]
    [InlineData("")]
    public void Validate_KeyNotThirtyTwoBytes_FailsWithoutPrintingIt(string key)
    {
        var result = _validator.Validate(null, Options("k1", ("k1", key)));

        Assert.True(result.Failed);
        Assert.Contains("Stores:KeyEncryptionKeys:k1 must be base64 of exactly 32 bytes", result.FailureMessage);
        Assert.True(key.Length == 0 || !result.FailureMessage.Contains(key, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("K1")]
    [InlineData("-k1")]
    [InlineData("k1\n")]
    [InlineData("a-key-id-that-is-much-longer-than-32")]
    public void Validate_InvalidKeyId_FailsWithoutPrintingIt(string keyId)
    {
        var result = _validator.Validate(null, Options(keyId, (keyId, RandomKey())));

        Assert.True(result.Failed);
        Assert.Contains("not 1 to 32 lower-case letters", result.FailureMessage);
        Assert.DoesNotContain(keyId, result.FailureMessage);
    }

    [Fact]
    public void ToString_Options_NeverPrintsAKey()
    {
        var key = RandomKey();

        Assert.DoesNotContain(key, Options("k1", ("k1", key)).ToString());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("false")]
    public void AddStoreCredentials_Disabled_RegistersNothing(string? enabled)
    {
        var services = new ServiceCollection();

        services.AddStoreCredentials(Configuration(("Stores:Enabled", enabled)));

        Assert.Empty(services);
    }

    [Fact]
    public void AddStoreCredentials_EnabledWithKeys_SealsAndOpens()
    {
        using var provider = Provider(("Stores:Enabled", "true"), ("Stores:CurrentKeyId", "k1"), ("Stores:KeyEncryptionKeys:k1", RandomKey()));
        provider.GetRequiredService<IStartupValidator>().Validate();
        var credentials = provider.GetRequiredService<IStoreCredentials>();

        var opened = credentials.Open(credentials.Seal(Descriptor(), Context), Context);

        Assert.Equal(Descriptor(), opened);
        Assert.Equal("k1", provider.GetRequiredService<IKeyWrapper>().CurrentKeyId);
    }

    [Fact]
    public void AddStoreCredentials_EnabledWithoutKeys_FailsStartupValidation()
    {
        using var provider = Provider(("Stores:Enabled", "true"));

        var exception = Assert.Throws<OptionsValidationException>(() => provider.GetRequiredService<IStartupValidator>().Validate());

        Assert.Contains("Stores:CurrentKeyId is required", exception.Message);
    }

    [Fact]
    public void AddStoreCredentials_EnabledWithAShortKey_FailsStartupValidationWithoutPrintingIt()
    {
        var shortKey = Convert.ToBase64String(new byte[16]);
        using var provider = Provider(("Stores:Enabled", "true"), ("Stores:CurrentKeyId", "k1"), ("Stores:KeyEncryptionKeys:k1", shortKey));

        var exception = Assert.Throws<OptionsValidationException>(() => provider.GetRequiredService<IStartupValidator>().Validate());

        Assert.DoesNotContain(shortKey, exception.Message);
    }

    private static IConfiguration Configuration(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Where(value => value.Value is not null).Select(value => KeyValuePair.Create(value.Key, value.Value)))
            .Build();

    private static ServiceProvider Provider(params (string Key, string? Value)[] values) =>
        new ServiceCollection()
            .AddLogging()
            .AddStoreCredentials(Configuration(values))
            .BuildServiceProvider();
}
