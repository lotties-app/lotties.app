using System.Net;
using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// A validated endpoint: <see cref="Address"/> is what the connection opens (never a name, so DNS cannot change it later)
/// and <see cref="HostName"/> is the typed name the server certificate and SNI are checked against. The address is internal
/// to the API and, like the host, never returned to a caller or logged (<see cref="ToString"/> prints neither).
/// </summary>
public sealed record PinnedEndpoint(IPAddress Address, StoreHostName HostName, int Port)
{
    /// <inheritdoc />
    public override string ToString() => nameof(PinnedEndpoint) + " { redacted }";
}
