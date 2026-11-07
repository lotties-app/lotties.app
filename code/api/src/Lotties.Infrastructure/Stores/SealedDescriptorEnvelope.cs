using System.Text;
using Lotties.Application.Stores;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The byte layout of a sealed store descriptor, version 1 (docs/design/47-bring-your-own-database.md section 3.3):
/// <code>
/// "LSD" (3) | version 0x01 (1) | key id length n (1) | key id, ASCII (n) | wrapped key length m (1) | wrapped data key (m)
///   | nonce (12) | tag (16) | ciphertext (rest, at least 1)
/// </code>
/// The ciphertext is the descriptor JSON under AES-256-GCM with the per-record data key and the nonce. The associated data
/// of both the payload and the wrapped key is <see cref="AssociatedData"/>: magic, version, a purpose byte, the store id and
/// the owner id (16 bytes each, big-endian RFC 4122 order), so a blob moved to another row, or a wrapped key reused as a
/// payload key, fails to authenticate. Changing anything here needs a new version byte; stored blobs are a frozen format.
/// </summary>
internal sealed record SealedDescriptorEnvelope(string KeyId, byte[] WrappedKey, byte[] Nonce, byte[] Tag, byte[] Ciphertext)
{
    public const byte Version1 = 1;
    public const int NonceSize = 12;
    public const int TagSize = 16;
    public const int DataKeySize = 32;
    public const byte PayloadPurpose = 1;
    public const byte KeyWrapPurpose = 2;

    private static readonly byte[] Magic = "LSD"u8.ToArray();
    private const int GuidSize = 16;

    /// <summary>Parses the layout; throws <see cref="StoreCredentialsUnreadableException"/> (malformed or unsupported version).</summary>
    public static SealedDescriptorEnvelope Parse(ReadOnlySpan<byte> bytes)
    {
        var reader = new EnvelopeReader(bytes);
        reader.ExpectMagicAndVersion();
        var keyId = Encoding.ASCII.GetString(reader.ReadLengthPrefixed());
        var wrappedKey = reader.ReadLengthPrefixed().ToArray();
        var nonce = reader.Read(NonceSize).ToArray();
        var tag = reader.Read(TagSize).ToArray();
        var ciphertext = reader.ReadRest().ToArray();
        return IsValidKeyId(keyId)
            ? new SealedDescriptorEnvelope(keyId, wrappedKey, nonce, tag, ciphertext)
            : throw Malformed();
    }

    /// <summary>The key id stored in the header, or null when the bytes are not a readable envelope.</summary>
    public static string? TryReadKeyId(ReadOnlySpan<byte> bytes)
    {
        try
        {
            return Parse(bytes).KeyId;
        }
        catch (StoreCredentialsUnreadableException)
        {
            return null;
        }
    }

    /// <summary>The associated data binding a seal of version 1 to its row, for the given purpose.</summary>
    public static byte[] AssociatedData(StoreSealContext context, byte purpose)
    {
        ArgumentNullException.ThrowIfNull(context);
        var buffer = new byte[Magic.Length + 2 + (2 * GuidSize)];
        Magic.CopyTo(buffer, 0);
        buffer[Magic.Length] = Version1;
        buffer[Magic.Length + 1] = purpose;
        context.StoreId.TryWriteBytes(buffer.AsSpan(Magic.Length + 2, GuidSize), bigEndian: true, out _);
        context.OwnerId.TryWriteBytes(buffer.AsSpan(Magic.Length + 2 + GuidSize, GuidSize), bigEndian: true, out _);
        return buffer;
    }

    public byte[] ToBytes()
    {
        var keyId = Encoding.ASCII.GetBytes(KeyId);
        using var stream = new MemoryStream();
        stream.Write(Magic);
        stream.WriteByte(Version1);
        WriteLengthPrefixed(stream, keyId);
        WriteLengthPrefixed(stream, WrappedKey);
        stream.Write(Nonce);
        stream.Write(Tag);
        stream.Write(Ciphertext);
        return stream.ToArray();
    }

    public SealedDescriptorEnvelope WithWrappedKey(WrappedDataKey wrapped) =>
        this with { KeyId = wrapped.KeyId, WrappedKey = wrapped.Ciphertext.ToArray() };

    public override string ToString() => $"{nameof(SealedDescriptorEnvelope)} {{ KeyId = {KeyId}, Length = {Ciphertext.Length} }}";

    private static bool IsValidKeyId(string keyId) => StoreCredentialsOptionsValidator.IsValidKeyId(keyId);

    private static void WriteLengthPrefixed(Stream stream, byte[] value)
    {
        stream.WriteByte(checked((byte)value.Length));
        stream.Write(value);
    }

    private static StoreCredentialsUnreadableException Malformed() => new(StoreCredentialsFailure.Malformed);

    private ref struct EnvelopeReader(ReadOnlySpan<byte> bytes)
    {
        private ReadOnlySpan<byte> _remaining = bytes;

        public void ExpectMagicAndVersion()
        {
            if (!Read(Magic.Length).SequenceEqual(Magic))
            {
                throw Malformed();
            }

            if (Read(1)[0] != Version1)
            {
                throw new StoreCredentialsUnreadableException(StoreCredentialsFailure.UnsupportedVersion);
            }
        }

        public ReadOnlySpan<byte> ReadLengthPrefixed()
        {
            var length = Read(1)[0];
            return length > 0 ? Read(length) : throw Malformed();
        }

        public ReadOnlySpan<byte> Read(int count)
        {
            if (_remaining.Length < count)
            {
                throw Malformed();
            }

            var value = _remaining[..count];
            _remaining = _remaining[count..];
            return value;
        }

        public ReadOnlySpan<byte> ReadRest()
        {
            var rest = _remaining;
            _remaining = [];
            return rest.IsEmpty ? throw Malformed() : rest;
        }
    }
}
