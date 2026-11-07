using System.Net;
using System.Net.Sockets;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Infrastructure.Stores;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>The egress guard against a scripted resolver: no test here reaches the network.</summary>
public sealed class StoreEndpointGuardTests
{
    private const string Name = "db.example.com";

    private readonly FakeHostResolver _resolver = new();

    private StoreEndpointGuard Guard(Action<StoreEndpointGuardOptions>? configure = null, bool allowLoopback = false)
    {
        var options = new StoreEndpointGuardOptions { ResolveTimeoutSeconds = 1, AllowLoopbackForTests = allowLoopback };
        configure?.Invoke(options);
        return new StoreEndpointGuard(_resolver, Options.Create(options));
    }

    /// <summary>Hosts refused before any resolution: not a host name, numeric spellings, special-use names, injection characters.</summary>
    public static TheoryData<string?> InvalidHosts => new()
    {
        null,
        "",
        "2130706433",
        "0x7f000001",
        "0177.0.0.1",
        "0x7f.1",
        "127.1",
        "017700000001",
        "postgres://db.example.com",
        "db.example.com:5432",
        "db.example.com/postgres",
        "user@db.example.com",
        "db.example.com ",
        "db.example.com\r\nHost=10.0.0.1",
        "db.example.com;Host=10.0.0.1",
        "db.example.com;Options=-c",
        "db.example.com'",
        "db.example.com\"",
        "Host=db.example.com",
        "localhost",
        "postgres.localhost",
        "nas.local",
        "metadata.google.internal",
        "kubernetes.default.svc.cluster.local",
        "router.home.arpa",
        "db",
        "[::ffff:127.0.0.1]",
        "fe80::1%25eth0",
    };

    /// <summary>Literal addresses that are not globally routable.</summary>
    public static TheoryData<string> BlockedLiterals => new()
    {
        "127.0.0.1",
        "127.0.53.53",
        "0.0.0.0",
        "10.0.0.1",
        "10.43.0.10",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.10",
        "100.64.0.1",
        "100.100.100.100",
        "169.254.169.254",
        "169.254.170.2",
        "224.0.0.251",
        "240.0.0.1",
        "255.255.255.255",
        "192.0.2.10",
        "198.18.0.1",
        "::1",
        "::",
        "fc00::1",
        "fd7a:115c:a1e0::1",
        "fe80::1",
        "fec0::1",
        "ff02::1",
        "::ffff:10.0.0.1",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "::ffff:0:a00:1",
        "64:ff9b::a00:1",
        "64:ff9b::a9fe:a9fe",
        "64:ff9b:1::808:808",
        "2002:a00:1::1",
        "2002:c0a8:101::1",
        "2001:0:4136:e378:8000:63bf:3fff:fdd2",
        "2001:db8::1",
        "::a00:1",
        "::7f00:1",
        "100::1",
    };

    /// <summary>Resolver answers where at least one address is not public: the whole name is refused.</summary>
    public static TheoryData<string[]> BlockedAnswers => new()
    {
        new[] { "10.0.0.5" },
        new[] { "127.0.0.1" },
        new[] { "169.254.169.254" },
        new[] { "8.8.8.8", "192.168.0.10" },
        new[] { "192.168.0.10", "8.8.8.8" },
        new[] { "1.1.1.1", "100.64.12.7" },
        new[] { "2606:4700::6810:84e5", "fd00::1" },
        new[] { "2606:4700::6810:84e5", "::1" },
        new[] { "104.16.132.229", "fe80::1" },
        new[] { "::ffff:192.168.1.1" },
        new[] { "64:ff9b::a00:1" },
        new[] { "0.0.0.0" },
    };

    [Theory]
    [MemberData(nameof(InvalidHosts))]
    public async Task PinAsync_InvalidHost_ThrowsInvalidHostWithoutResolving(string? host)
    {
        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().PinAsync(host, 5432));

        Assert.Equal("endpoint_invalid_host", exception.Code);
        Assert.Equal(0, _resolver.Calls);
    }

    [Theory]
    [MemberData(nameof(BlockedLiterals))]
    public async Task PinAsync_NonPublicLiteral_ThrowsBlockedAddressWithoutEchoingIt(string host)
    {
        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().PinAsync(host, 5432));

        Assert.Equal("endpoint_blocked_address", exception.Code);
        AssertNoLeak(exception, host);
        Assert.Equal(0, _resolver.Calls);
    }

    [Theory]
    [MemberData(nameof(BlockedAnswers))]
    public async Task PinAsync_NameWithANonPublicAddress_ThrowsBlockedAddressWithoutEchoingIt(string[] answer)
    {
        _resolver.Answer(answer);

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().PinAsync(Name, 5432));

        Assert.Equal("endpoint_blocked_address", exception.Code);
        Assert.All(answer, address => AssertNoLeak(exception, address));
        AssertNoLeak(exception, Name);
    }

    [Theory]
    [InlineData("8.8.8.8", "8.8.8.8")]
    [InlineData("2606:4700:4700::1111", "2606:4700:4700::1111")]
    [InlineData("::ffff:8.8.8.8", "8.8.8.8")]
    [InlineData("64:ff9b::808:808", "8.8.8.8")]
    public async Task PinAsync_PublicLiteral_PinsTheAddressReallyReached(string host, string expected)
    {
        var pinned = await Guard().PinAsync(host, 5432);

        Assert.Equal(IPAddress.Parse(expected), pinned.Address);
        Assert.Equal(0, _resolver.Calls);
    }

    [Fact]
    public async Task PinAsync_PublicName_PinsTheAddressAndKeepsTheTypedNameForTls()
    {
        _resolver.Answer("1.1.1.1");

        var pinned = await Guard().PinAsync("DB.Example.com", 6543);

        Assert.Equal(IPAddress.Parse("1.1.1.1"), pinned.Address);
        Assert.Equal(Name, pinned.HostName.Value);
        Assert.Equal(6543, pinned.Port);
        Assert.Equal([Name], _resolver.Names);
    }

    [Fact]
    public async Task PinAsync_DualStackName_PrefersIPv4()
    {
        _resolver.Answer("2606:4700::6810:84e5", "104.16.132.229");

        var pinned = await Guard().PinAsync(Name, 5432);

        Assert.Equal(IPAddress.Parse("104.16.132.229"), pinned.Address);
    }

    [Fact]
    public async Task PinAsync_IPv6OnlyName_PinsTheIPv6Address()
    {
        _resolver.Answer("2a05:d014::1");

        var pinned = await Guard().PinAsync(Name, 5432);

        Assert.Equal(AddressFamily.InterNetworkV6, pinned.Address.AddressFamily);
    }

    [Theory]
    [InlineData(5433)]
    [InlineData(22)]
    [InlineData(443)]
    [InlineData(6379)]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(65536)]
    public async Task PinAsync_PortNotAllowed_ThrowsPortNotAllowedWithoutResolving(int port)
    {
        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().PinAsync(Name, port));

        Assert.Equal("endpoint_port_not_allowed", exception.Code);
        Assert.Equal(0, _resolver.Calls);
    }

    [Fact]
    public async Task PinAsync_OperatorExtraPort_IsAllowed()
    {
        _resolver.Answer("1.1.1.1");

        var pinned = await Guard(options => options.ExtraAllowedPorts = [15432]).PinAsync(Name, 15432);

        Assert.Equal(15432, pinned.Port);
    }

    [Fact]
    public async Task PinAsync_AddressOnOperatorDenyList_ThrowsBlockedAddress()
    {
        _resolver.Answer("8.8.4.4");

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(
            () => Guard(options => options.DeniedNetworks = ["8.8.4.0/24"]).PinAsync(Name, 5432));

        Assert.Equal("endpoint_blocked_address", exception.Code);
    }

    [Fact]
    public async Task PinAsync_EmptyAnswer_ThrowsUnresolvable()
    {
        _resolver.Answer();

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().PinAsync(Name, 5432));

        Assert.Equal("endpoint_unresolvable", exception.Code);
    }

    [Fact]
    public async Task PinAsync_ResolverFailure_ThrowsUnresolvableWithoutTheResolverText()
    {
        _resolver.Fail(new SocketException((int)SocketError.HostNotFound, "db.example.com not found at 10.0.0.53"));

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().PinAsync(Name, 5432));

        Assert.Equal("endpoint_unresolvable", exception.Code);
        Assert.Null(exception.InnerException);
        AssertNoLeak(exception, "10.0.0.53");
    }

    [Fact]
    public async Task PinAsync_ResolverTimeout_ThrowsUnresolvable()
    {
        _resolver.Hang();

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().PinAsync(Name, 5432));

        Assert.Equal("endpoint_unresolvable", exception.Code);
    }

    [Fact]
    public async Task PinAsync_CallerCancels_ThrowsOperationCanceled()
    {
        _resolver.Hang();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Guard().PinAsync(Name, 5432, cancellation.Token));
    }

    [Fact]
    public async Task RecheckAsync_NameRebindsToPrivateAddress_ThrowsBlockedAddress()
    {
        _resolver.Answer("1.1.1.1").Answer("127.0.0.1");
        var guard = Guard();
        var pinned = await guard.PinAsync(Name, 5432);

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => guard.RecheckAsync(pinned));

        Assert.Equal("endpoint_blocked_address", exception.Code);
        Assert.Equal(2, _resolver.Calls);
    }

    [Fact]
    public async Task RecheckAsync_NameAddsAMetadataAddress_ThrowsBlockedAddress()
    {
        _resolver.Answer("1.1.1.1").Answer("1.1.1.1", "169.254.169.254");
        var guard = Guard();
        var pinned = await guard.PinAsync(Name, 5432);

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => guard.RecheckAsync(pinned));

        Assert.Equal("endpoint_blocked_address", exception.Code);
    }

    [Fact]
    public async Task RecheckAsync_NameMovesToAnotherPublicAddress_PinsTheNewAddress()
    {
        _resolver.Answer("1.1.1.1").Answer("1.0.0.1");
        var guard = Guard();
        var pinned = await guard.PinAsync(Name, 5432);

        var rechecked = await guard.RecheckAsync(pinned);

        Assert.Equal(IPAddress.Parse("1.0.0.1"), rechecked.Address);
        Assert.Equal(pinned.HostName, rechecked.HostName);
    }

    [Fact]
    public async Task RecheckAsync_RuleTightenedSincePin_ThrowsBlockedAddress()
    {
        var pinned = new PinnedEndpoint(IPAddress.Parse("10.0.0.1"), Domain.Stores.StoreHostName.Parse("10.0.0.1"), 5432);

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard().RecheckAsync(pinned));

        Assert.Equal("endpoint_blocked_address", exception.Code);
    }

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("::1")]
    public async Task PinAsync_LoopbackWithTestSeam_IsAllowed(string host)
    {
        var pinned = await Guard(allowLoopback: true).PinAsync(host, 5432);

        Assert.True(IPAddress.IsLoopback(pinned.Address));
    }

    [Theory]
    [InlineData("10.0.0.1")]
    [InlineData("169.254.169.254")]
    [InlineData("192.168.1.1")]
    public async Task PinAsync_PrivateAddressWithTestSeam_StillThrowsBlockedAddress(string host)
    {
        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => Guard(allowLoopback: true).PinAsync(host, 5432));

        Assert.Equal("endpoint_blocked_address", exception.Code);
    }

    [Fact]
    public async Task PinnedEndpoint_ToString_PrintsNeitherAddressNorHost()
    {
        _resolver.Answer("1.1.1.1");
        var pinned = await Guard().PinAsync(Name, 5432);

        var text = pinned.ToString();

        Assert.DoesNotContain("1.1.1.1", text, StringComparison.Ordinal);
        Assert.DoesNotContain(Name, text, StringComparison.Ordinal);
    }

    private static void AssertNoLeak(StoreEndpointRejectedException exception, string value)
    {
        Assert.DoesNotContain(value, exception.Message, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(value, exception.ToString(), StringComparison.OrdinalIgnoreCase);
        Assert.All(exception.Details.Values, detail => Assert.DoesNotContain(value, detail?.ToString() ?? "", StringComparison.OrdinalIgnoreCase));
    }
}
