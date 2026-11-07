using System.Globalization;
using System.Net;
using System.Net.Sockets;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Stores;

/// <summary>
/// The host of a user's database, as typed: a public DNS name (lower-cased ASCII, at least two labels, letters in the last
/// label, no special-use suffix such as <c>.local</c> or <c>.internal</c>) or a literal IP in canonical form (dotted
/// decimal IPv4 without leading zeros, or IPv6 without brackets or zone). Anything else, including numeric spellings that
/// some resolvers read as an address (<c>2130706433</c>, <c>0x7f000001</c>, <c>0177.0.0.1</c>, <c>127.1</c>), a scheme,
/// a port, a path, user info or whitespace, is refused. Docs: docs/design/47-bring-your-own-database.md section 3.2.
/// </summary>
public readonly record struct StoreHostName
{
    /// <summary>Longest DNS name (RFC 1035).</summary>
    public const int MaxLength = 253;

    private const int MaxLabelLength = 63;

    private static readonly string[] SpecialUseSuffixes =
    [
        "localhost", "local", "internal", "home.arpa", "arpa", "invalid", "test", "example", "onion",
        "lan", "home", "corp", "intranet", "private", "localdomain",
    ];

    private StoreHostName(string value, IPAddress? address)
    {
        Value = value;
        Address = address;
    }

    /// <summary>The normalized host (lower case); for a literal IP, its canonical text.</summary>
    public string Value { get; }

    /// <summary>The address when the host is a literal IP; null for a DNS name.</summary>
    public IPAddress? Address { get; }

    /// <summary>True when the host is a literal IP and needs no resolution.</summary>
    public bool IsAddressLiteral => Address is not null;

    /// <summary>Parses a typed host or throws <see cref="StoreEndpointRejectedException"/> (<c>endpoint_invalid_host</c>).</summary>
    public static StoreHostName Parse(string? typed)
    {
        if (string.IsNullOrEmpty(typed) || typed.Length > MaxLength || !typed.All(IsHostCharacter))
        {
            throw Invalid();
        }

        var lowered = typed.ToLowerInvariant();
        return lowered.Contains(':', StringComparison.Ordinal) ? ParseIPv6(lowered) : ParseNameOrIPv4(lowered);
    }

    /// <inheritdoc />
    public override string ToString() => Value;

    private static StoreHostName ParseIPv6(string lowered)
    {
        if (!IPAddress.TryParse(lowered, out var address) || address.AddressFamily != AddressFamily.InterNetworkV6 || address.ScopeId != 0)
        {
            throw Invalid();
        }

        return new StoreHostName(address.ToString(), address);
    }

    private static StoreHostName ParseNameOrIPv4(string lowered)
    {
        var labels = lowered.Split('.');
        return labels[^1].All(char.IsAsciiDigit) ? ParseCanonicalIPv4(lowered, labels) : ParseName(lowered, labels);
    }

    private static StoreHostName ParseCanonicalIPv4(string lowered, string[] labels)
    {
        if (labels.Length != 4 || !labels.All(IsCanonicalOctet))
        {
            throw Invalid();
        }

        return new StoreHostName(lowered, IPAddress.Parse(lowered));
    }

    private static StoreHostName ParseName(string lowered, string[] labels)
    {
        if (labels.Length < 2 || !labels.All(IsValidLabel) || IsSpecialUse(lowered))
        {
            throw Invalid();
        }

        return new StoreHostName(lowered, null);
    }

    private static bool IsHostCharacter(char character) =>
        char.IsAsciiLetterOrDigit(character) || character is '.' or '-' or ':';

    private static bool IsCanonicalOctet(string label) =>
        label.Length is >= 1 and <= 3
        && label.All(char.IsAsciiDigit)
        && (label.Length == 1 || label[0] != '0')
        && int.Parse(label, NumberStyles.None, CultureInfo.InvariantCulture) <= 255;

    private static bool IsValidLabel(string label) =>
        label.Length is >= 1 and <= MaxLabelLength
        && label[0] != '-'
        && label[^1] != '-'
        && label.All(character => char.IsAsciiLetterLower(character) || char.IsAsciiDigit(character) || character == '-');

    private static bool IsSpecialUse(string lowered) =>
        SpecialUseSuffixes.Any(suffix => lowered == suffix || lowered.EndsWith("." + suffix, StringComparison.Ordinal));

    private static StoreEndpointRejectedException Invalid() => new(StoreEndpointFailure.InvalidHost);
}
