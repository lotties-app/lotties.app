namespace Lotties.Api.Assistants.Alexa;

/// <summary>
/// Amazon's rules for the <c>SignatureCertChainUrl</c> header (host a custom skill as a web service, "Verify the URL"):
/// after normalizing the path (dot segments resolved), the scheme is <c>https</c> (any case), the host
/// <c>s3.amazonaws.com</c> (any case), the port 443 or absent, and the path starts with <c>/echo.api/</c> (case
/// sensitive). Anything else is refused before any download, so the header can never make the API fetch another URL.
/// </summary>
public static class AlexaCertificateUrl
{
    public const string Host = "s3.amazonaws.com";
    public const string PathPrefix = "/echo.api/";
    private const int MaxLength = 2048;

    public static bool TryParse(string? value, out Uri url)
    {
        url = null!;
        if (string.IsNullOrWhiteSpace(value) || value.Length > MaxLength || !Uri.TryCreate(value.Trim(), UriKind.Absolute, out var parsed))
        {
            return false;
        }

        url = parsed;
        return IsAmazonEchoCertificate(parsed);
    }

    private static bool IsAmazonEchoCertificate(Uri url) =>
        string.Equals(url.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
        && string.Equals(url.Host, Host, StringComparison.OrdinalIgnoreCase)
        && url.Port == 443
        && string.IsNullOrEmpty(url.UserInfo)
        && url.AbsolutePath.StartsWith(PathPrefix, StringComparison.Ordinal);
}
