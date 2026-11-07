using System.Security.Cryptography;

namespace Lotties.Infrastructure.Stores;

/// <summary>Fills a buffer with cryptographically secure random bytes; replaced only by known-answer tests.</summary>
internal delegate void RandomFill(Span<byte> buffer);

internal static class SecureRandom
{
    public static readonly RandomFill Fill = RandomNumberGenerator.Fill;
}
