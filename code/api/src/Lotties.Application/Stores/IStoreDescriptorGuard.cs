using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// The checks a descriptor passes before it is sealed and saved (docs/design/47-bring-your-own-database.md section 3.2, task T6):
/// both endpoints through the egress guard (port allowlist, resolution, every address public, a pin), the connection fields in the
/// shape the connection layer accepts, and a pasted CA that parses. Opens no connection. Failures throw
/// <see cref="Domain.Exceptions.StoreEndpointRejectedException"/> (an <c>endpoint_*</c> code, never a host or an address).
/// </summary>
public interface IStoreDescriptorGuard
{
    Task CheckAsync(StoreDescriptor descriptor, CancellationToken cancellationToken = default);
}
