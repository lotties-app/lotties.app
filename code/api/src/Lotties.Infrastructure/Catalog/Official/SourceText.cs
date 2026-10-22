using System.Text;

namespace Lotties.Infrastructure.Catalog.Official;

/// <summary>A downloaded source file as text, and the encoding it was read with.</summary>
public sealed record DecodedSource(string Text, string EncodingName);

/// <summary>
/// Decodes the open data files: a UTF-8 (or UTF-16) byte order mark wins; otherwise valid UTF-8 is read as UTF-8 and
/// anything else as Windows-1252, the "ANSI" encoding ANVISA documents for the registered-medicines file (a superset
/// of ISO-8859-1 for printable characters, so curly quotes and dashes do not become control characters).
/// </summary>
public static class SourceText
{
    private static readonly UTF8Encoding StrictUtf8 = new(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true);

    static SourceText() => Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

    public static DecodedSource Decode(byte[] bytes)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        var withBom = BomEncoding(bytes);
        if (withBom is not null)
        {
            return new DecodedSource(withBom.GetString(bytes, withBom.Preamble.Length, bytes.Length - withBom.Preamble.Length), withBom.WebName);
        }

        return TryUtf8(bytes) ?? new DecodedSource(Encoding.GetEncoding(1252).GetString(bytes), "windows-1252");
    }

    private static Encoding? BomEncoding(byte[] bytes) =>
        new Encoding[] { Encoding.UTF8, Encoding.Unicode, Encoding.BigEndianUnicode }
            .FirstOrDefault(encoding => encoding.Preamble.Length > 0 && bytes.AsSpan().StartsWith(encoding.Preamble));

    private static DecodedSource? TryUtf8(byte[] bytes)
    {
        try
        {
            return new DecodedSource(StrictUtf8.GetString(bytes), "utf-8");
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }
}
