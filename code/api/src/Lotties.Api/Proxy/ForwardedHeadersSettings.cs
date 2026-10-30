using System.Net;

namespace Lotties.Api.Proxy;

/// <summary>
/// Reverse proxies whose <c>X-Forwarded-For</c> and <c>X-Forwarded-Proto</c> headers are trusted (section
/// <c>ForwardedHeaders</c>, or env <c>FORWARDED_HEADERS_TRUSTED_NETWORKS</c>). Loopback is always trusted.
/// </summary>
public sealed class ForwardedHeadersSettings
{
    public const string SectionName = "ForwardedHeaders";

    /// <summary>The private IPv4 ranges (RFC 1918): container, pod and LAN networks where a reverse proxy usually runs.</summary>
    public const string DefaultTrustedNetworks = "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";

    /// <summary>Comma-separated CIDR networks, e.g. <c>10.42.0.0/16,fd00::/8</c>. Empty or unset: <see cref="DefaultTrustedNetworks"/>.</summary>
    public string? TrustedNetworks { get; set; }

    /// <summary>The configured entries, trimmed, or the default ones when nothing is configured.</summary>
    public IReadOnlyList<string> Entries => (string.IsNullOrWhiteSpace(TrustedNetworks) ? DefaultTrustedNetworks : TrustedNetworks)
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    /// <summary>The entries that parse as CIDR networks.</summary>
    public IReadOnlyList<IPNetwork> Networks() => Entries
        .Select(Parse)
        .OfType<IPNetwork>()
        .ToArray();

    /// <summary>The entries that are not CIDR networks; non-empty fails startup.</summary>
    public IReadOnlyList<string> InvalidEntries() => Entries
        .Where(entry => Parse(entry) is null)
        .ToArray();

    /// <summary>
    /// CIDR notation read as the ASP.NET Core 8 parser (<c>Microsoft.AspNetCore.HttpOverrides.IPNetwork</c>, obsolete since
    /// .NET 10) read it: bits set after the prefix are ignored, so <c>10.0.0.1/8</c> is <c>10.0.0.0/8</c>.
    /// <see cref="IPNetwork.TryParse(string?, out IPNetwork)"/> rejects such an entry, which would fail a configuration that
    /// started before the upgrade.
    /// </summary>
    private static IPNetwork? Parse(string entry)
    {
        var slash = entry.IndexOf('/');
        if (slash < 0 || !IPAddress.TryParse(entry.AsSpan(0, slash), out var address) || !int.TryParse(entry.AsSpan(slash + 1), out var prefixLength))
        {
            return null;
        }

        var bytes = address.GetAddressBytes();
        return prefixLength >= 0 && prefixLength <= bytes.Length * 8 ? new IPNetwork(new IPAddress(ClearHostBits(bytes, prefixLength)), prefixLength) : null;
    }

    private static byte[] ClearHostBits(byte[] bytes, int prefixLength)
    {
        for (var bit = prefixLength; bit < bytes.Length * 8; bit++)
        {
            bytes[bit / 8] &= (byte)~(0x80 >> (bit % 8));
        }

        return bytes;
    }
}
