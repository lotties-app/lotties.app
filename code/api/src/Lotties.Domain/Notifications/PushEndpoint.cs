using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Notifications;

/// <summary>
/// The capability URL a browser's push service gave for one subscription: an absolute <c>https</c> URL on port 443,
/// without user info, at most <see cref="MaxLength"/> characters. It is never logged or returned; it is looked up by
/// <see cref="Hash"/>. Whether its host is a known push service is checked apart (<see cref="PushEndpointAllowlist"/>).
/// </summary>
public readonly record struct PushEndpoint
{
    public const int MaxLength = 2048;
    private const int HttpsPort = 443;
    private const string Field = "endpoint";

    private PushEndpoint(string value, string host)
    {
        Value = value;
        Host = host;
    }

    public string Value { get; }

    /// <summary>The lower-case host name.</summary>
    public string Host { get; }

    /// <summary>SHA-256 of <see cref="Value"/> as unpadded base64url (43 characters), the unique lookup key.</summary>
    public string Hash => Base64UrlText.Sha256(Value);

    public static PushEndpoint From(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new DomainValidationException(Field, "endpoint is required.");
        }

        if (value.Length > MaxLength)
        {
            throw new DomainValidationException(Field, $"endpoint must be at most {MaxLength} characters.");
        }

        return Uri.TryCreate(value, UriKind.Absolute, out var uri) && IsAcceptable(uri)
            ? new PushEndpoint(value, uri.IdnHost.ToLowerInvariant())
            : throw new DomainValidationException(Field, "endpoint must be an absolute https URL on port 443 without user info.");
    }

    /// <summary>The endpoint hash a client-supplied URL would have, without validating it (for revoke-by-endpoint lookups).</summary>
    public static string HashOf(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return Base64UrlText.Sha256(value);
    }

    public override string ToString() => "[push endpoint]";

    private static bool IsAcceptable(Uri uri) =>
        uri.Scheme == Uri.UriSchemeHttps
        && uri.Port == HttpsPort
        && string.IsNullOrEmpty(uri.UserInfo)
        && !string.IsNullOrEmpty(uri.Host)
        && uri.HostNameType == UriHostNameType.Dns;
}
