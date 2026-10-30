using System.Net;
using Lotties.Api.Proxy;

namespace Lotties.Api.Tests.Proxy;

public sealed class ForwardedHeadersSettingsTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void Entries_NotConfigured_AreThePrivateRanges(string? trustedNetworks)
    {
        var settings = new ForwardedHeadersSettings { TrustedNetworks = trustedNetworks };

        Assert.Equal(["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"], settings.Entries);
    }

    [Fact]
    public void Networks_CommaSeparated_AreTrimmedAndParsed()
    {
        var settings = new ForwardedHeadersSettings { TrustedNetworks = " 10.42.0.0/16 , fd00::/8,, " };

        var networks = settings.Networks();

        Assert.Equal(
            [(IPAddress.Parse("10.42.0.0"), 16), (IPAddress.Parse("fd00::"), 8)],
            networks.Select(network => (network.BaseAddress, network.PrefixLength)));
        Assert.Empty(settings.InvalidEntries());
    }

    [Fact]
    public void Networks_BitsAfterThePrefix_AreIgnoredAsBeforeTheNet10Upgrade()
    {
        var settings = new ForwardedHeadersSettings { TrustedNetworks = "10.42.0.1/16,fd00::1/8" };

        var networks = settings.Networks();

        Assert.Equal(
            [(IPAddress.Parse("10.42.0.0"), 16), (IPAddress.Parse("fd00::"), 8)],
            networks.Select(network => (network.BaseAddress, network.PrefixLength)));
        Assert.Empty(settings.InvalidEntries());
    }

    [Fact]
    public void InvalidEntries_NotCidr_AreReported()
    {
        var settings = new ForwardedHeadersSettings { TrustedNetworks = "10.0.0.0/8,proxy.local,10.0.0.1,10.0.0.0/40" };

        Assert.Equal(["proxy.local", "10.0.0.1", "10.0.0.0/40"], settings.InvalidEntries());
        Assert.Single(settings.Networks());
    }
}
