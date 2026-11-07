using System.Net;
using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

public sealed class PublicAddressPolicyTests
{
    private static readonly IReadOnlyList<IPNetwork> NoDenyList = [];

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("127.255.255.254")]
    [InlineData("0.0.0.0")]
    [InlineData("0.1.2.3")]
    [InlineData("10.0.0.1")]
    [InlineData("10.255.255.255")]
    [InlineData("172.16.0.1")]
    [InlineData("172.31.255.255")]
    [InlineData("192.168.0.1")]
    [InlineData("100.64.0.1")]
    [InlineData("100.127.255.254")]
    [InlineData("169.254.169.254")]
    [InlineData("169.254.0.1")]
    [InlineData("192.0.0.8")]
    [InlineData("192.0.2.1")]
    [InlineData("192.88.99.1")]
    [InlineData("198.18.0.1")]
    [InlineData("198.19.255.255")]
    [InlineData("198.51.100.7")]
    [InlineData("203.0.113.9")]
    [InlineData("224.0.0.1")]
    [InlineData("239.255.255.250")]
    [InlineData("240.0.0.1")]
    [InlineData("255.255.255.255")]
    [InlineData("::")]
    [InlineData("::1")]
    [InlineData("fc00::1")]
    [InlineData("fd00:ec2::254")]
    [InlineData("fe80::1")]
    [InlineData("febf::1")]
    [InlineData("fec0::1")]
    [InlineData("ff02::1")]
    [InlineData("::ffff:10.0.0.1")]
    [InlineData("::ffff:127.0.0.1")]
    [InlineData("::ffff:169.254.169.254")]
    [InlineData("::a00:1")]
    [InlineData("64:ff9b::a00:1")]
    [InlineData("64:ff9b::7f00:1")]
    [InlineData("64:ff9b:1::808:808")]
    [InlineData("2002:a00:1::1")]
    [InlineData("2002:808:808::1")]
    [InlineData("2001:0:4136:e378:8000:63bf:3fff:fdd2")]
    [InlineData("2001:db8::1")]
    [InlineData("2001:10::1")]
    [InlineData("3fff::1")]
    [InlineData("100::1")]
    public void IsAllowed_NonPublicAddress_ReturnsFalse(string address)
    {
        var allowed = PublicAddressPolicy.IsAllowed(IPAddress.Parse(address), NoDenyList);

        Assert.False(allowed);
    }

    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("1.1.1.1")]
    [InlineData("172.15.255.255")]
    [InlineData("172.32.0.1")]
    [InlineData("100.63.255.255")]
    [InlineData("100.128.0.1")]
    [InlineData("192.169.0.1")]
    [InlineData("223.255.255.254")]
    [InlineData("2606:4700:4700::1111")]
    [InlineData("2a05:d014::1")]
    [InlineData("2001:4860:4860::8888")]
    [InlineData("::ffff:8.8.8.8")]
    [InlineData("64:ff9b::808:808")]
    public void IsAllowed_PublicAddress_ReturnsTrue(string address)
    {
        var allowed = PublicAddressPolicy.IsAllowed(IPAddress.Parse(address), NoDenyList);

        Assert.True(allowed);
    }

    [Fact]
    public void IsAllowed_AddressOnDenyList_ReturnsFalse()
    {
        var allowed = PublicAddressPolicy.IsAllowed(IPAddress.Parse("8.8.8.8"), [IPNetwork.Parse("8.8.8.0/24")]);

        Assert.False(allowed);
    }

    [Fact]
    public void IsAllowed_MappedAddressOnIPv4DenyList_ReturnsFalse()
    {
        var allowed = PublicAddressPolicy.IsAllowed(IPAddress.Parse("::ffff:8.8.8.8"), [IPNetwork.Parse("8.8.8.8/32")]);

        Assert.False(allowed);
    }

    [Fact]
    public void IsAllowed_AddressWithZone_ReturnsFalse()
    {
        var address = IPAddress.Parse("2606:4700:4700::1111");
        address.ScopeId = 3;

        var allowed = PublicAddressPolicy.IsAllowed(address, NoDenyList);

        Assert.False(allowed);
    }

    [Theory]
    [InlineData("::ffff:8.8.8.8", "8.8.8.8")]
    [InlineData("64:ff9b::808:808", "8.8.8.8")]
    [InlineData("1.1.1.1", "1.1.1.1")]
    [InlineData("2606:4700:4700::1111", "2606:4700:4700::1111")]
    public void Effective_EmbeddedIPv4_ReturnsTheAddressReallyReached(string address, string expected)
    {
        var effective = PublicAddressPolicy.Effective(IPAddress.Parse(address));

        Assert.Equal(IPAddress.Parse(expected), effective);
    }
}
