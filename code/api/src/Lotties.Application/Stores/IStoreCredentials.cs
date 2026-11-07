using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// The narrow service that seals and opens store descriptors (docs/design/47-bring-your-own-database.md section 3.3).
/// The plaintext descriptor exists only between <see cref="Open"/> and the connection it builds; it is never logged and
/// no endpoint returns it. Registered only when <c>Stores:Enabled</c> is true.
/// </summary>
public interface IStoreCredentials
{
    /// <summary>Encrypts <paramref name="descriptor"/> under a fresh data key wrapped by the current key, bound to <paramref name="context"/>.</summary>
    SealedDescriptor Seal(StoreDescriptor descriptor, StoreSealContext context);

    /// <summary>
    /// Decrypts a descriptor sealed for the same <paramref name="context"/>. Throws
    /// <see cref="StoreCredentialsUnreadableException"/> (no inner exception, no value in the message) when the blob is
    /// malformed, of an unknown version, wrapped by a key that is not configured, tampered with, or sealed for another row.
    /// </summary>
    StoreDescriptor Open(SealedDescriptor sealedDescriptor, StoreSealContext context);

    /// <summary>
    /// Re-wraps the data key of <paramref name="sealedDescriptor"/> with the current key, keeping the encrypted descriptor as
    /// it is (key rotation). Fails like <see cref="Open"/>.
    /// </summary>
    SealedDescriptor Rewrap(SealedDescriptor sealedDescriptor, StoreSealContext context);

    /// <summary>Whether the blob's data key is wrapped by the current key (false also for a blob that cannot be parsed).</summary>
    bool IsWrappedWithCurrentKey(SealedDescriptor sealedDescriptor);
}
