using System.Security.Cryptography;
using System.Text;

namespace Lotties.Domain.Notifications;

/// <summary>Unpadded base64url (RFC 4648 section 5) helpers; .NET 8 has no built-in Base64Url type.</summary>
internal static class Base64UrlText
{
    public static string Encode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>SHA-256 of the UTF-8 text as unpadded base64url (43 characters).</summary>
    public static string Sha256(string value) => Encode(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    /// <summary>Decodes unpadded (or padded) base64url; <c>null</c> when <paramref name="value"/> is not valid base64url.</summary>
    public static byte[]? TryDecode(string value)
    {
        if (value.Length % 4 == 1 || value.Contains('+') || value.Contains('/'))
        {
            return null;
        }

        var base64 = value.TrimEnd('=').Replace('-', '+').Replace('_', '/');
        var padded = base64.PadRight(base64.Length + ((4 - (base64.Length % 4)) % 4), '=');
        var buffer = new byte[padded.Length];
        return Convert.TryFromBase64String(padded, buffer, out var written) ? buffer[..written] : null;
    }
}
