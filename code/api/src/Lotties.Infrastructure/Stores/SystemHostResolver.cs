using System.Net;
using System.Net.Sockets;
using Lotties.Application.Stores;

namespace Lotties.Infrastructure.Stores;

/// <summary>The system resolver (IPv4 and IPv6). Only the guard calls it, with its own timeout; tests replace it with a fake.</summary>
internal sealed class SystemHostResolver : IHostResolver
{
    public async Task<IReadOnlyList<IPAddress>> ResolveAsync(string hostName, CancellationToken cancellationToken = default) =>
        await Dns.GetHostAddressesAsync(hostName, AddressFamily.Unspecified, cancellationToken);
}
