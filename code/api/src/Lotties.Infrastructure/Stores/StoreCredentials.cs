using System.Security.Cryptography;
using System.Text.Json;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// <see cref="IStoreCredentials"/> with envelope encryption (docs/design/47-bring-your-own-database.md section 3.3): each
/// seal draws a fresh 32-byte data key and a fresh 96-bit nonce, encrypts the descriptor JSON with AES-256-GCM and has the
/// <see cref="IKeyWrapper"/> wrap the data key; layout in <see cref="SealedDescriptorEnvelope"/>. Logs carry the store id,
/// the key id and the failure class only; plaintext buffers and data keys are cleared after use.
/// </summary>
internal sealed class StoreCredentials : IStoreCredentials
{
    private readonly IKeyWrapper _keyWrapper;
    private readonly ILogger<StoreCredentials> _logger;
    private readonly RandomFill _random;

    public StoreCredentials(IKeyWrapper keyWrapper, ILogger<StoreCredentials> logger)
        : this(keyWrapper, logger, SecureRandom.Fill)
    {
    }

    internal StoreCredentials(IKeyWrapper keyWrapper, ILogger<StoreCredentials> logger, RandomFill random)
    {
        _keyWrapper = keyWrapper ?? throw new ArgumentNullException(nameof(keyWrapper));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _random = random ?? throw new ArgumentNullException(nameof(random));
    }

    public SealedDescriptor Seal(StoreDescriptor descriptor, StoreSealContext context)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentNullException.ThrowIfNull(context);
        var plaintext = StoreDescriptorPayload.Serialize(descriptor);
        var dataKey = new byte[SealedDescriptorEnvelope.DataKeySize];
        try
        {
            var envelope = Encrypt(plaintext, dataKey, context);
            _logger.LogDebug("Sealed the descriptor of store {StoreId} with key {KeyId}", context.StoreId, envelope.KeyId);
            return SealedDescriptor.FromBytes(envelope.ToBytes());
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
            CryptographicOperations.ZeroMemory(dataKey);
        }
    }

    public StoreDescriptor Open(SealedDescriptor sealedDescriptor, StoreSealContext context)
    {
        ArgumentNullException.ThrowIfNull(sealedDescriptor);
        ArgumentNullException.ThrowIfNull(context);
        try
        {
            return Decrypt(SealedDescriptorEnvelope.Parse(sealedDescriptor.AsSpan()), context);
        }
        catch (StoreCredentialsUnreadableException exception)
        {
            _logger.LogWarning("The descriptor of store {StoreId} could not be opened ({Failure})", context.StoreId, exception.Failure);
            throw;
        }
    }

    public SealedDescriptor Rewrap(SealedDescriptor sealedDescriptor, StoreSealContext context)
    {
        ArgumentNullException.ThrowIfNull(sealedDescriptor);
        ArgumentNullException.ThrowIfNull(context);
        try
        {
            var envelope = SealedDescriptorEnvelope.Parse(sealedDescriptor.AsSpan());
            var rewrapped = RewrapEnvelope(envelope, context);
            _logger.LogInformation("Re-wrapped the descriptor of store {StoreId} from key {OldKeyId} to key {KeyId}", context.StoreId, envelope.KeyId, rewrapped.KeyId);
            return SealedDescriptor.FromBytes(rewrapped.ToBytes());
        }
        catch (StoreCredentialsUnreadableException exception)
        {
            _logger.LogWarning("The descriptor of store {StoreId} could not be re-wrapped ({Failure})", context.StoreId, exception.Failure);
            throw;
        }
    }

    public bool IsWrappedWithCurrentKey(SealedDescriptor sealedDescriptor)
    {
        ArgumentNullException.ThrowIfNull(sealedDescriptor);
        return SealedDescriptorEnvelope.TryReadKeyId(sealedDescriptor.AsSpan()) == _keyWrapper.CurrentKeyId;
    }

    private SealedDescriptorEnvelope Encrypt(byte[] plaintext, byte[] dataKey, StoreSealContext context)
    {
        var nonce = new byte[SealedDescriptorEnvelope.NonceSize];
        var tag = new byte[SealedDescriptorEnvelope.TagSize];
        var ciphertext = new byte[plaintext.Length];
        _random(dataKey);
        _random(nonce);
        using (var aes = new AesGcm(dataKey, SealedDescriptorEnvelope.TagSize))
        {
            aes.Encrypt(nonce, plaintext, ciphertext, tag, SealedDescriptorEnvelope.AssociatedData(context, SealedDescriptorEnvelope.PayloadPurpose));
        }

        var wrapped = _keyWrapper.Wrap(dataKey, SealedDescriptorEnvelope.AssociatedData(context, SealedDescriptorEnvelope.KeyWrapPurpose));
        return new SealedDescriptorEnvelope(wrapped.KeyId, wrapped.Ciphertext.ToArray(), nonce, tag, ciphertext);
    }

    private StoreDescriptor Decrypt(SealedDescriptorEnvelope envelope, StoreSealContext context)
    {
        var dataKey = UnwrapDataKey(envelope, context);
        var plaintext = new byte[envelope.Ciphertext.Length];
        try
        {
            DecryptPayload(envelope, dataKey, plaintext, context);
            return ReadDescriptor(plaintext);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(dataKey);
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private SealedDescriptorEnvelope RewrapEnvelope(SealedDescriptorEnvelope envelope, StoreSealContext context)
    {
        var dataKey = UnwrapDataKey(envelope, context);
        var plaintext = new byte[envelope.Ciphertext.Length];
        try
        {
            DecryptPayload(envelope, dataKey, plaintext, context);
            return envelope.WithWrappedKey(_keyWrapper.Wrap(dataKey, SealedDescriptorEnvelope.AssociatedData(context, SealedDescriptorEnvelope.KeyWrapPurpose)));
        }
        finally
        {
            CryptographicOperations.ZeroMemory(dataKey);
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private byte[] UnwrapDataKey(SealedDescriptorEnvelope envelope, StoreSealContext context)
    {
        if (!_keyWrapper.CanUnwrap(envelope.KeyId))
        {
            throw new StoreCredentialsUnreadableException(StoreCredentialsFailure.UnknownKey);
        }

        var dataKey = _keyWrapper.Unwrap(new WrappedDataKey(envelope.KeyId, envelope.WrappedKey), SealedDescriptorEnvelope.AssociatedData(context, SealedDescriptorEnvelope.KeyWrapPurpose));
        return dataKey.Length == SealedDescriptorEnvelope.DataKeySize
            ? dataKey
            : throw new StoreCredentialsUnreadableException(StoreCredentialsFailure.Malformed);
    }

    private static void DecryptPayload(SealedDescriptorEnvelope envelope, byte[] dataKey, byte[] plaintext, StoreSealContext context)
    {
        try
        {
            using var aes = new AesGcm(dataKey, SealedDescriptorEnvelope.TagSize);
            aes.Decrypt(envelope.Nonce, envelope.Ciphertext, envelope.Tag, plaintext, SealedDescriptorEnvelope.AssociatedData(context, SealedDescriptorEnvelope.PayloadPurpose));
        }
        catch (CryptographicException)
        {
            throw new StoreCredentialsUnreadableException(StoreCredentialsFailure.AuthenticationFailed);
        }
    }

    private static StoreDescriptor ReadDescriptor(byte[] plaintext)
    {
        try
        {
            return StoreDescriptorPayload.Deserialize(plaintext);
        }
        catch (Exception exception) when (exception is JsonException or FormatException or DomainValidationException or ArgumentException or NotSupportedException)
        {
            throw new StoreCredentialsUnreadableException(StoreCredentialsFailure.InvalidDescriptor);
        }
    }
}
