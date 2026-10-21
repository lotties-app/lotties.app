namespace BabyRoutine.Infrastructure.Push;

/// <summary>Unpadded base64url (RFC 4648 section 5); .NET 8 has no built-in Base64Url type.</summary>
internal static class Base64Url
{
    public static string Encode(ReadOnlySpan<byte> bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Decodes unpadded (or padded) base64url; <c>null</c> when <paramref name="value"/> is not valid base64url.</summary>
    public static byte[]? TryDecode(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length % 4 == 1 || value.Contains('+') || value.Contains('/'))
        {
            return null;
        }

        var base64 = value.TrimEnd('=').Replace('-', '+').Replace('_', '/');
        var padded = base64.PadRight(base64.Length + ((4 - (base64.Length % 4)) % 4), '=');
        var buffer = new byte[padded.Length];
        return Convert.TryFromBase64String(padded, buffer, out var written) ? buffer[..written] : null;
    }
}
