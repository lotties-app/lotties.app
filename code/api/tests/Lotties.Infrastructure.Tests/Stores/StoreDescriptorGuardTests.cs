using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>The checks of a descriptor the owner saves (task T6): both endpoints through the egress guard, the fields, the CA; no network.</summary>
public sealed class StoreDescriptorGuardTests
{
    private readonly FakeHostResolver _resolver = new();

    [Fact]
    public async Task Check_PublicHostsAndAPasswordWithSeparators_Passes()
    {
        _resolver.Answer("8.8.8.8").Answer("1.1.1.1");

        await Guard().CheckAsync(Descriptor(appPassword: "a=b;Options=-c x 'q'"));

        Assert.Equal(["pool.example.com", "direct.example.com"], _resolver.Names);
    }

    [Fact]
    public async Task Check_MigratorHostResolvesToAPrivateAddress_IsRefusedAsBlocked()
    {
        _resolver.Answer("8.8.8.8").Answer("10.0.0.5");

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().CheckAsync(Descriptor()));

        Assert.Equal("endpoint_blocked_address", exception.Code);
        Assert.DoesNotContain("10.0.0.5", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Check_AppPortNotAllowed_IsRefusedBeforeAnyResolution()
    {
        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().CheckAsync(Descriptor(appPort: 3306)));

        Assert.Equal("endpoint_port_not_allowed", exception.Code);
        Assert.Equal(0, _resolver.Calls);
    }

    [Fact]
    public async Task Check_UnreadableCa_IsRefusedBeforeAnyResolution()
    {
        var descriptor = Descriptor(caPem: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----");

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().CheckAsync(descriptor));

        Assert.Equal("endpoint_invalid_ca", exception.Code);
        Assert.Equal(0, _resolver.Calls);
    }

    private StoreDescriptorGuard Guard() =>
        new(new StoreEndpointGuard(_resolver, Options.Create(new StoreEndpointGuardOptions { ResolveTimeoutSeconds = 1 })));

    private static StoreDescriptor Descriptor(string appPassword = "app-pw", int appPort = 6543, string? caPem = null) =>
        StoreDescriptor.Create(
            "Example",
            StoreEndpoint.Create("pool.example.com", appPort, "familydb", "lotties_app", appPassword),
            StoreMigratorEndpoint.Create("direct.example.com", 5432, "lotties_migrator", "mig-pw"),
            caPem is null ? StoreTlsPolicy.Create(StoreSslMode.VerifyFull, null) : UncheckedCa(caPem));

    /// <summary>The domain checks only the PEM's shape; a block whose bytes are not a certificate passes it and fails the parse.</summary>
    private static StoreTlsPolicy UncheckedCa(string pem) => StoreTlsPolicy.Create(StoreSslMode.VerifyFull, pem);
}
