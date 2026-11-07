namespace Lotties.Application.Stores;

/// <summary>A per-record data key encrypted by a key-encryption key, and the id of that key.</summary>
public sealed record WrappedDataKey(string KeyId, ReadOnlyMemory<byte> Ciphertext);

/// <summary>
/// Wraps and unwraps the per-record data keys of sealed store descriptors with key-encryption keys the API holds
/// outside the database (docs/design/47-bring-your-own-database.md section 3.3; today from configuration, later maybe a
/// KMS). New wraps always use <see cref="CurrentKeyId"/>; older keys stay usable for unwrapping while they are configured,
/// which is what lets keys rotate without asking anyone for their credentials again.
/// </summary>
public interface IKeyWrapper
{
    /// <summary>The id of the key every new wrap uses.</summary>
    string CurrentKeyId { get; }

    /// <summary>Whether a key with this id is configured (current or previous).</summary>
    bool CanUnwrap(string keyId);

    /// <summary>Encrypts <paramref name="dataKey"/> with the current key, bound to <paramref name="associatedData"/>.</summary>
    WrappedDataKey Wrap(ReadOnlySpan<byte> dataKey, ReadOnlySpan<byte> associatedData);

    /// <summary>
    /// Decrypts a data key wrapped by <see cref="Wrap"/> with the same <paramref name="associatedData"/>. Throws
    /// <see cref="StoreCredentialsUnreadableException"/> when the key id is unknown or the wrapped key does not authenticate.
    /// The caller clears the returned bytes after use.
    /// </summary>
    byte[] Unwrap(WrappedDataKey wrapped, ReadOnlySpan<byte> associatedData);
}
