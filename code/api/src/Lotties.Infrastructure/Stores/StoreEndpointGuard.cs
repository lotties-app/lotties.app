using System.Collections.Frozen;
using System.Net;
using System.Net.Sockets;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// <see cref="IStoreEndpointGuard"/>: parse the host and port, resolve the name once through <see cref="IHostResolver"/>,
/// refuse the endpoint when <b>any</b> address is not public (a name with one private A record among public ones is
/// refused), and pin one validated address (IPv4 first). Docs: docs/design/47-bring-your-own-database.md section 3.2.
/// </summary>
internal sealed class StoreEndpointGuard : IStoreEndpointGuard
{
    private readonly IHostResolver _resolver;
    private readonly FrozenSet<int> _extraPorts;
    private readonly IReadOnlyList<IPNetwork> _deniedNetworks;
    private readonly TimeSpan _resolveTimeout;
    private readonly bool _allowLoopback;

    public StoreEndpointGuard(IHostResolver resolver, IOptions<StoreEndpointGuardOptions> options)
    {
        ArgumentNullException.ThrowIfNull(resolver);
        ArgumentNullException.ThrowIfNull(options);
        var settings = options.Value;
        _resolver = resolver;
        _extraPorts = settings.ExtraAllowedPorts.ToFrozenSet();
        _deniedNetworks = settings.DeniedNetworks.Select(network => IPNetwork.Parse(network)).ToArray();
        _resolveTimeout = TimeSpan.FromSeconds(settings.ResolveTimeoutSeconds);
        _allowLoopback = settings.AllowLoopbackForTests;
    }

    public async Task<PinnedEndpoint> PinAsync(string? host, int port, CancellationToken cancellationToken = default)
    {
        var hostName = StoreHostName.Parse(host);
        var allowedPort = StorePortPolicy.EnsureAllowed(port, _extraPorts);
        var addresses = await ResolveAsync(hostName, cancellationToken);
        var validated = addresses.Select(EnsureAllowed).ToArray();
        return new PinnedEndpoint(ChoosePinned(validated), hostName, allowedPort);
    }

    public Task<PinnedEndpoint> RecheckAsync(PinnedEndpoint previous, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(previous);
        return PinAsync(previous.HostName.Value, previous.Port, cancellationToken);
    }

    private async Task<IReadOnlyList<IPAddress>> ResolveAsync(StoreHostName hostName, CancellationToken cancellationToken)
    {
        if (hostName.Address is { } literal)
        {
            return [literal];
        }

        var addresses = await ResolveNameAsync(hostName.Value, cancellationToken);
        return addresses.Count > 0 ? addresses : throw new StoreEndpointRejectedException(StoreEndpointFailure.Unresolvable);
    }

    private async Task<IReadOnlyList<IPAddress>> ResolveNameAsync(string hostName, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_resolveTimeout);
        try
        {
            return await _resolver.ResolveAsync(hostName, timeout.Token);
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            throw new StoreEndpointRejectedException(StoreEndpointFailure.Unresolvable);
        }
    }

    private IPAddress EnsureAllowed(IPAddress address)
    {
        if (_allowLoopback && IPAddress.IsLoopback(address))
        {
            return address;
        }

        return PublicAddressPolicy.IsAllowed(address, _deniedNetworks)
            ? PublicAddressPolicy.Effective(address)!
            : throw new StoreEndpointRejectedException(StoreEndpointFailure.BlockedAddress);
    }

    private static IPAddress ChoosePinned(IPAddress[] validated) =>
        validated.FirstOrDefault(address => address.AddressFamily == AddressFamily.InterNetwork) ?? validated[0];
}
