using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Lotties.Domain.Board;

/// <summary>
/// The secret of a board API key: <see cref="Marker"/> followed by 43 base64url characters (32 bytes of CSPRNG output, no
/// padding), 47 characters in all. The fixed marker lets secret scanners find leaked keys (<c>lbk_[A-Za-z0-9_-]{43}</c>).
/// Only its SHA-256 (<see cref="HashOf"/>) and its first <see cref="PrefixLength"/> characters are ever stored.
/// </summary>
public static partial class BoardKeySecret
{
    public const string Marker = "lbk_";
    public const int Length = 47;
    public const int PrefixLength = 12;
    public const int HashLength = 64;
    private const int RandomBytes = 32;

    /// <summary>A new secret from the operating system's cryptographically secure generator.</summary>
    public static string Generate() =>
        Marker + Convert.ToBase64String(RandomNumberGenerator.GetBytes(RandomBytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Whether <paramref name="value"/> has the shape of a secret (it may still be unknown or revoked).</summary>
    public static bool IsWellFormed(string? value) => value is { Length: Length } && Pattern().IsMatch(value);

    /// <summary>Whether a presented credential looks like a board key at all (used to route it away from the JWT schemes).</summary>
    public static bool HasMarker(string? value) => value is not null && value.StartsWith(Marker, StringComparison.Ordinal);

    public static string PrefixOf(string secret)
    {
        ArgumentNullException.ThrowIfNull(secret);
        return secret[..Math.Min(PrefixLength, secret.Length)];
    }

    /// <summary>The lower-case hex SHA-256 of the secret's UTF-8 bytes.</summary>
    public static string HashOf(string secret)
    {
        ArgumentNullException.ThrowIfNull(secret);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret))).ToLowerInvariant();
    }

    /// <summary>Compares two hex hashes in constant time (no early exit on the first different character).</summary>
    public static bool HashesEqual(string left, string right)
    {
        ArgumentNullException.ThrowIfNull(left);
        ArgumentNullException.ThrowIfNull(right);
        return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(left), Encoding.ASCII.GetBytes(right));
    }

    [GeneratedRegex(@"^lbk_[A-Za-z0-9_-]{43}\z", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
