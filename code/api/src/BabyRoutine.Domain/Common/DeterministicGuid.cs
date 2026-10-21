using System.Security.Cryptography;
using System.Text;

namespace BabyRoutine.Domain.Common;

/// <summary>
/// Name-based UUIDs (RFC 4122 version 5, SHA-1): the same namespace and name always give the same id, so imports
/// can be replayed without creating duplicates.
/// </summary>
public static class DeterministicGuid
{
    private const int GuidLength = 16;

    public static Guid Create(Guid namespaceId, string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var input = new byte[GuidLength + nameBytes.Length];
        namespaceId.TryWriteBytes(input.AsSpan(0, GuidLength), bigEndian: true, out _);
        nameBytes.CopyTo(input, GuidLength);
#pragma warning disable CA5350 // SHA-1 is mandated by RFC 4122 version 5; the id is an identifier, not a security boundary.
        var hash = SHA1.HashData(input);
#pragma warning restore CA5350
        hash[6] = (byte)((hash[6] & 0x0F) | 0x50);
        hash[8] = (byte)((hash[8] & 0x3F) | 0x80);
        return new Guid(hash.AsSpan(0, GuidLength), bigEndian: true);
    }
}
