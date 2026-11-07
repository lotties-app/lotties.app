using System.Reflection;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Infrastructure.Stores;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.Stores;

public sealed class StoreEndpointGuardOptionsTests
{
    private static ServiceProvider Provider(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        return new ServiceCollection().AddStoreEndpointGuard(configuration).BuildServiceProvider();
    }

    [Fact]
    public void AllowLoopbackForTests_IsNotAPublicSetting()
    {
        var property = typeof(StoreEndpointGuardOptions).GetProperty("AllowLoopbackForTests", BindingFlags.Public | BindingFlags.Instance);

        Assert.Null(property);
    }

    [Fact]
    public async Task AddStoreEndpointGuard_ConfigurationAsksForTheLoopbackSeam_LoopbackStaysBlocked()
    {
        using var provider = Provider(new()
        {
            ["StoreEndpointGuard:AllowLoopbackForTests"] = "true",
            ["StoreEndpointGuard__AllowLoopbackForTests"] = "true",
        });
        var guard = provider.GetRequiredService<IStoreEndpointGuard>();

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => guard.PinAsync("127.0.0.1", 5432));

        Assert.Equal("endpoint_blocked_address", exception.Code);
        Assert.False(provider.GetRequiredService<IOptions<StoreEndpointGuardOptions>>().Value.AllowLoopbackForTests);
    }

    [Fact]
    public async Task AddStoreEndpointGuard_BindsPublicSettings()
    {
        using var provider = Provider(new()
        {
            ["StoreEndpointGuard:ExtraAllowedPorts:0"] = "15432",
            ["StoreEndpointGuard:DeniedNetworks:0"] = "8.8.8.0/24",
            ["StoreEndpointGuard:ResolveTimeoutSeconds"] = "2",
        });
        var options = provider.GetRequiredService<IOptions<StoreEndpointGuardOptions>>().Value;
        var guard = provider.GetRequiredService<IStoreEndpointGuard>();

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => guard.PinAsync("8.8.8.8", 15432));

        Assert.Equal([15432], options.ExtraAllowedPorts);
        Assert.Equal(2, options.ResolveTimeoutSeconds);
        Assert.Equal("endpoint_blocked_address", exception.Code);
    }

    [Theory]
    [InlineData("StoreEndpointGuard:ExtraAllowedPorts:0", "22")]
    [InlineData("StoreEndpointGuard:ExtraAllowedPorts:0", "70000")]
    [InlineData("StoreEndpointGuard:DeniedNetworks:0", "not-a-network")]
    [InlineData("StoreEndpointGuard:ResolveTimeoutSeconds", "0")]
    [InlineData("StoreEndpointGuard:ResolveTimeoutSeconds", "60")]
    public void AddStoreEndpointGuard_InvalidSetting_FailsValidation(string key, string value)
    {
        using var provider = Provider(new() { [key] = value });

        Assert.Throws<OptionsValidationException>(() => provider.GetRequiredService<IOptions<StoreEndpointGuardOptions>>().Value);
    }
}
