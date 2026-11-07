using System.Net;

namespace Lotties.Application.Stores;

/// <summary>Resolves a DNS name to its addresses (IPv4 and IPv6). Injected so tests never reach the network.</summary>
public interface IHostResolver
{
    /// <summary>All addresses of <paramref name="hostName"/>; may throw on failure or return an empty list.</summary>
    Task<IReadOnlyList<IPAddress>> ResolveAsync(string hostName, CancellationToken cancellationToken = default);
}
