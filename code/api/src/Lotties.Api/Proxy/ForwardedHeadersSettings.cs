using ProxyNetwork = Microsoft.AspNetCore.HttpOverrides.IPNetwork;

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
    public IReadOnlyList<ProxyNetwork> Networks() => Entries
        .Select(Parse)
        .OfType<ProxyNetwork>()
        .ToArray();

    /// <summary>The entries that are not CIDR networks; non-empty fails startup.</summary>
    public IReadOnlyList<string> InvalidEntries() => Entries
        .Where(entry => Parse(entry) is null)
        .ToArray();

    private static ProxyNetwork? Parse(string entry) => ProxyNetwork.TryParse(entry, out var network) ? network : null;
}
