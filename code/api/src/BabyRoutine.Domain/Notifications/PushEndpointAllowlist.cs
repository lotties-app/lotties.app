using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Notifications;

/// <summary>
/// The hosts the server may POST pushes to (the SSRF guard: clients choose the endpoint URL). An entry is an exact host
/// (<c>fcm.googleapis.com</c>) or <c>*.</c> plus a suffix, which matches any subdomain of the suffix but not the suffix itself.
/// </summary>
public sealed class PushEndpointAllowlist
{
    private const string WildcardPrefix = "*.";

    /// <summary>The browser push services known on 2026-10-21 (Chrome/FCM, Firefox, Safari, Edge).</summary>
    public static readonly IReadOnlyList<string> DefaultHosts =
    [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "*.push.services.mozilla.com",
        "web.push.apple.com",
        "*.push.apple.com",
        "*.notify.windows.com",
    ];

    private readonly IReadOnlyList<string> _exactHosts;
    private readonly IReadOnlyList<string> _suffixes;

    private PushEndpointAllowlist(IReadOnlyList<string> exactHosts, IReadOnlyList<string> suffixes)
    {
        _exactHosts = exactHosts;
        _suffixes = suffixes;
    }

    public static PushEndpointAllowlist Default { get; } = Create(DefaultHosts);

    public static PushEndpointAllowlist Create(IEnumerable<string> entries)
    {
        ArgumentNullException.ThrowIfNull(entries);
        var normalized = entries.Select(Normalize).ToArray();
        if (normalized.Length == 0)
        {
            throw new ArgumentException("The push endpoint allowlist needs at least one host.", nameof(entries));
        }

        return new PushEndpointAllowlist(
            normalized.Where(entry => !entry.StartsWith(WildcardPrefix, StringComparison.Ordinal)).ToArray(),
            normalized.Where(entry => entry.StartsWith(WildcardPrefix, StringComparison.Ordinal)).Select(entry => entry[1..]).ToArray());
    }

    public bool Allows(PushEndpoint endpoint) =>
        _exactHosts.Contains(endpoint.Host, StringComparer.Ordinal)
        || _suffixes.Any(suffix => endpoint.Host.EndsWith(suffix, StringComparison.Ordinal));

    /// <summary>Throws <see cref="PushEndpointNotAllowedException"/> when the endpoint's host is not allowed.</summary>
    public PushEndpoint EnsureAllows(PushEndpoint endpoint) =>
        Allows(endpoint) ? endpoint : throw new PushEndpointNotAllowedException();

    private static string Normalize(string entry)
    {
        var trimmed = entry?.Trim().ToLowerInvariant();
        var host = trimmed is not null && trimmed.StartsWith(WildcardPrefix, StringComparison.Ordinal) ? trimmed[WildcardPrefix.Length..] : trimmed;
        return string.IsNullOrEmpty(host) || host.Contains('*') || Uri.CheckHostName(host) != UriHostNameType.Dns
            ? throw new ArgumentException($"'{entry}' is not a host name or a '*.' host suffix.", nameof(entry))
            : trimmed!;
    }
}
