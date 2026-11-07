namespace Lotties.Application.Stores;

/// <summary>
/// The egress guard of user-owned databases (docs/design/47-bring-your-own-database.md section 3.2): parses the typed host
/// and port, resolves the name itself, requires every resolved address to be public, and pins one of them. Failures throw
/// <see cref="Domain.Exceptions.StoreEndpointRejectedException"/> with an <c>endpoint_*</c> code and never echo an address.
/// </summary>
public interface IStoreEndpointGuard
{
    /// <summary>Validates the typed endpoint and returns the address to connect to, with the typed name kept for TLS.</summary>
    Task<PinnedEndpoint> PinAsync(string? host, int port, CancellationToken cancellationToken = default);

    /// <summary>
    /// Resolves and validates <paramref name="previous"/>'s host name again, as when a pool is rebuilt: a name that now
    /// resolves to any non-public address is refused (DNS rebinding), a literal IP is checked against the current rules.
    /// </summary>
    Task<PinnedEndpoint> RecheckAsync(PinnedEndpoint previous, CancellationToken cancellationToken = default);
}
