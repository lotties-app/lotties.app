namespace Lotties.Domain.Stores;

/// <summary>
/// A <see cref="StoreDescriptor"/> as stored: an opaque, authenticated and encrypted blob
/// (docs/design/47-bring-your-own-database.md section 3.3). Only the credentials service can open it, and only for the
/// store and owner it was sealed for. Holds a private copy of the bytes.
/// </summary>
public sealed class SealedDescriptor : IEquatable<SealedDescriptor>
{
    /// <summary>Far above a real descriptor (the largest part is a pasted CA of at most 32 KiB).</summary>
    public const int MaxLength = 64 * 1024;

    private readonly byte[] _bytes;

    private SealedDescriptor(byte[] bytes)
    {
        _bytes = bytes;
    }

    public int Length => _bytes.Length;

    /// <summary>Copies <paramref name="bytes"/>; throws <see cref="ArgumentException"/> when empty or longer than <see cref="MaxLength"/>.</summary>
    public static SealedDescriptor FromBytes(ReadOnlySpan<byte> bytes) =>
        bytes.Length is > 0 and <= MaxLength
            ? new SealedDescriptor(bytes.ToArray())
            : throw new ArgumentException($"A sealed descriptor is 1 to {MaxLength} bytes.", nameof(bytes));

    public ReadOnlySpan<byte> AsSpan() => _bytes;

    public byte[] ToArray() => (byte[])_bytes.Clone();

    public bool Equals(SealedDescriptor? other) => other is not null && _bytes.AsSpan().SequenceEqual(other._bytes);

    public override bool Equals(object? obj) => obj is SealedDescriptor other && Equals(other);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.AddBytes(_bytes);
        return hash.ToHashCode();
    }

    public override string ToString() => $"{nameof(SealedDescriptor)} {{ Length = {Length} }}";
}
