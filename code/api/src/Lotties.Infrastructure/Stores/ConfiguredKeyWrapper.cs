using System.Collections.Frozen;
using System.Security.Cryptography;
using System.Text;
using Lotties.Application.Stores;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// <see cref="IKeyWrapper"/> over the key-encryption keys of <see cref="StoreCredentialsOptions"/>. A wrapped data key is
/// <c>nonce (12) || ciphertext || tag (16)</c> under AES-256-GCM with a random nonce; its associated data is the key id
/// (length-prefixed) followed by the caller's associated data, so a wrapped key presented under another key id fails.
/// The keys are copied once at construction; nothing here logs.
/// </summary>
internal sealed class ConfiguredKeyWrapper : IKeyWrapper
{
    public const int NonceSize = 12;
    public const int TagSize = 16;

    private readonly FrozenDictionary<string, byte[]> _keys;
    private readonly RandomFill _random;

    public ConfiguredKeyWrapper(IOptions<StoreCredentialsOptions> options)
        : this(options, SecureRandom.Fill)
    {
    }

    internal ConfiguredKeyWrapper(IOptions<StoreCredentialsOptions> options, RandomFill random)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(random);
        var value = options.Value;
        _keys = value.KeyEncryptionKeys.ToFrozenDictionary(key => key.Key, key => DecodeOrThrow(key.Key, key.Value), StringComparer.Ordinal);
        CurrentKeyId = value.CurrentKeyId is { } current && _keys.ContainsKey(current)
            ? current
            : throw new InvalidOperationException($"{StoreCredentialsOptions.SectionName}:CurrentKeyId must name a configured key.");
        _random = random;
    }

    public string CurrentKeyId { get; }

    public bool CanUnwrap(string keyId) => _keys.ContainsKey(keyId);

    public WrappedDataKey Wrap(ReadOnlySpan<byte> dataKey, ReadOnlySpan<byte> associatedData)
    {
        var wrapped = new byte[NonceSize + dataKey.Length + TagSize];
        var nonce = wrapped.AsSpan(0, NonceSize);
        _random(nonce);
        using var aes = new AesGcm(_keys[CurrentKeyId], TagSize);
        aes.Encrypt(nonce, dataKey, wrapped.AsSpan(NonceSize, dataKey.Length), wrapped.AsSpan(NonceSize + dataKey.Length), BoundAssociatedData(CurrentKeyId, associatedData));
        return new WrappedDataKey(CurrentKeyId, wrapped);
    }

    public byte[] Unwrap(WrappedDataKey wrapped, ReadOnlySpan<byte> associatedData)
    {
        ArgumentNullException.ThrowIfNull(wrapped);
        if (!_keys.TryGetValue(wrapped.KeyId, out var key))
        {
            throw new StoreCredentialsUnreadableException(StoreCredentialsFailure.UnknownKey);
        }

        var bytes = wrapped.Ciphertext.Span;
        if (bytes.Length <= NonceSize + TagSize)
        {
            throw new StoreCredentialsUnreadableException(StoreCredentialsFailure.Malformed);
        }

        return Decrypt(key, wrapped.KeyId, bytes, associatedData);
    }

    private static byte[] Decrypt(byte[] key, string keyId, ReadOnlySpan<byte> bytes, ReadOnlySpan<byte> associatedData)
    {
        var dataKey = new byte[bytes.Length - NonceSize - TagSize];
        try
        {
            using var aes = new AesGcm(key, TagSize);
            aes.Decrypt(bytes[..NonceSize], bytes.Slice(NonceSize, dataKey.Length), bytes[^TagSize..], dataKey, BoundAssociatedData(keyId, associatedData));
            return dataKey;
        }
        catch (CryptographicException)
        {
            CryptographicOperations.ZeroMemory(dataKey);
            throw new StoreCredentialsUnreadableException(StoreCredentialsFailure.AuthenticationFailed);
        }
    }

    private static byte[] BoundAssociatedData(string keyId, ReadOnlySpan<byte> associatedData)
    {
        var id = Encoding.ASCII.GetBytes(keyId);
        var bound = new byte[1 + id.Length + associatedData.Length];
        bound[0] = checked((byte)id.Length);
        id.CopyTo(bound, 1);
        associatedData.CopyTo(bound.AsSpan(1 + id.Length));
        return bound;
    }

    private static byte[] DecodeOrThrow(string keyId, string value) =>
        StoreCredentialsOptionsValidator.IsValidKeyId(keyId) && StoreCredentialsOptionsValidator.DecodeKey(value) is { } key
            ? key
            : throw new InvalidOperationException($"{StoreCredentialsOptions.SectionName}:KeyEncryptionKeys has an invalid entry.");
}
