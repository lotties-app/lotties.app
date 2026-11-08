using Lotties.Application.Stores;
using Lotties.Domain.Stores;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The checks of a descriptor the owner saves (task T6): both endpoints through the egress guard (task T4: port allowlist,
/// resolution, every address public, a pin), the app and migrator connection fields in the shape the connection layer accepts, and
/// a pasted CA that parses (<see cref="StoreTrustAnchors"/>). The pins are discarded: every connection pins again. Opens no
/// connection and logs nothing.
/// </summary>
internal sealed class StoreDescriptorGuard(IStoreEndpointGuard guard) : IStoreDescriptorGuard
{
    public async Task CheckAsync(StoreDescriptor descriptor, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        StoreConnectionFields.Create(descriptor.App.Database, descriptor.App.Username, descriptor.App.Password.Reveal());
        StoreConnectionFields.Create(descriptor.App.Database, descriptor.Migrator.Username, descriptor.Migrator.Password.Reveal());
        EnsureCaReadable(descriptor.Tls);
        await guard.PinAsync(descriptor.App.Host, descriptor.App.Port, cancellationToken);
        await guard.PinAsync(descriptor.Migrator.Host, descriptor.Migrator.Port, cancellationToken);
    }

    private static void EnsureCaReadable(StoreTlsPolicy tls)
    {
        if (tls.CaCertificatePem is { } pem)
        {
            StoreTrustAnchors.FromPem(pem).Clear();
        }
    }
}
