using System.Net;
using System.Net.Sockets;

namespace Lotties.Domain.Stores;

/// <summary>
/// Decides whether an address is globally routable, i.e. one the API may open a database connection to
/// (docs/design/47-bring-your-own-database.md section 3.2 step 3). IPv4: everything except the special-purpose ranges
/// (loopback, <c>0/8</c>, RFC 1918, CGNAT <c>100.64/10</c>, link-local and cloud metadata <c>169.254/16</c>, IETF and
/// documentation blocks, benchmarking, the 6to4 relay anycast, multicast, reserved and broadcast). IPv6: only global
/// unicast <c>2000::/3</c>, minus the IETF protocol block <c>2001::/23</c> (Teredo included), documentation and the
/// 6to4 tunnel prefix; an IPv4-mapped address or a well-known NAT64 address (<c>64:ff9b::/96</c>) is judged by the IPv4
/// address it carries; the local-use NAT64 prefix, ULA, link-local, site-local, multicast, loopback, unspecified and the
/// deprecated IPv4-compatible forms fall outside <c>2000::/3</c> and are refused. An address with a zone is refused.
/// </summary>
public static class PublicAddressPolicy
{
    private static readonly IPNetwork[] NonPublicIPv4 =
    [
        IPNetwork.Parse("0.0.0.0/8"),
        IPNetwork.Parse("10.0.0.0/8"),
        IPNetwork.Parse("100.64.0.0/10"),
        IPNetwork.Parse("127.0.0.0/8"),
        IPNetwork.Parse("169.254.0.0/16"),
        IPNetwork.Parse("172.16.0.0/12"),
        IPNetwork.Parse("192.0.0.0/24"),
        IPNetwork.Parse("192.0.2.0/24"),
        IPNetwork.Parse("192.88.99.0/24"),
        IPNetwork.Parse("192.168.0.0/16"),
        IPNetwork.Parse("198.18.0.0/15"),
        IPNetwork.Parse("198.51.100.0/24"),
        IPNetwork.Parse("203.0.113.0/24"),
        IPNetwork.Parse("224.0.0.0/4"),
        IPNetwork.Parse("240.0.0.0/4"),
    ];

    private static readonly IPNetwork GlobalUnicastIPv6 = IPNetwork.Parse("2000::/3");

    private static readonly IPNetwork WellKnownNat64 = IPNetwork.Parse("64:ff9b::/96");

    private static readonly IPNetwork[] NonPublicGlobalIPv6 =
    [
        IPNetwork.Parse("2001::/23"),
        IPNetwork.Parse("2001:db8::/32"),
        IPNetwork.Parse("2002::/16"),
        IPNetwork.Parse("3fff::/20"),
    ];

    /// <summary>True when <paramref name="address"/> is globally routable and outside <paramref name="denied"/> (the operator's own list).</summary>
    public static bool IsAllowed(IPAddress address, IReadOnlyList<IPNetwork> denied)
    {
        ArgumentNullException.ThrowIfNull(address);
        ArgumentNullException.ThrowIfNull(denied);
        var effective = Effective(address);
        return effective is not null && IsPublic(effective) && !denied.Any(network => network.Contains(effective));
    }

    /// <summary>
    /// The address a connection would really reach: the IPv4 address inside an IPv4-mapped or well-known NAT64 address, the
    /// address itself otherwise; null for an address with a zone (never allowed).
    /// </summary>
    public static IPAddress? Effective(IPAddress address)
    {
        ArgumentNullException.ThrowIfNull(address);
        return address switch
        {
            { AddressFamily: AddressFamily.InterNetworkV6, ScopeId: not 0 } => null,
            { IsIPv4MappedToIPv6: true } => address.MapToIPv4(),
            _ when WellKnownNat64.Contains(address) => EmbeddedIPv4(address),
            _ => address,
        };
    }

    private static bool IsPublic(IPAddress address) => address.AddressFamily switch
    {
        AddressFamily.InterNetwork => !NonPublicIPv4.Any(network => network.Contains(address)),
        AddressFamily.InterNetworkV6 => GlobalUnicastIPv6.Contains(address) && !NonPublicGlobalIPv6.Any(network => network.Contains(address)),
        _ => false,
    };

    private static IPAddress EmbeddedIPv4(IPAddress address) => new(address.GetAddressBytes().AsSpan(12, 4));
}
