using System.Collections.Frozen;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Stores;

/// <summary>
/// The ports a user's store may use (docs/design/47-bring-your-own-database.md section 3.2 step 2): Postgres 5432 and the
/// pooler port 6543, plus the few ports the operator lists for provider presets.
/// </summary>
public static class StorePortPolicy
{
    /// <summary>Ports always allowed: Postgres and the transaction-mode pooler.</summary>
    public static readonly IReadOnlySet<int> DefaultPorts = new[] { 5432, 6543 }.ToFrozenSet();

    /// <summary>Returns <paramref name="port"/> when it is allowed, or throws <see cref="StoreEndpointRejectedException"/> (<c>endpoint_port_not_allowed</c>).</summary>
    public static int EnsureAllowed(int port, IReadOnlySet<int> extraPorts)
    {
        ArgumentNullException.ThrowIfNull(extraPorts);
        if (!DefaultPorts.Contains(port) && !extraPorts.Contains(port))
        {
            throw new StoreEndpointRejectedException(StoreEndpointFailure.PortNotAllowed);
        }

        return port;
    }
}
