using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>The certificate chain (leaf first) a <c>SignatureCertChainUrl</c> names, or <c>null</c> when it cannot be had.</summary>
public interface IAlexaCertificateChainProvider
{
    Task<X509Certificate2Collection?> GetAsync(Uri url, CancellationToken cancellationToken = default);
}

/// <summary>
/// Downloads the PEM chain of an already checked <see cref="AlexaCertificateUrl"/> over the named client
/// <see cref="HttpClientName"/> (no redirects, no cookies, <see cref="AlexaOptions.CertDownloadTimeoutSeconds"/>, at most
/// <see cref="AlexaOptions.CertMaxBytes"/>) and caches it per URL for <see cref="AlexaOptions.CertCacheMinutes"/> (never past
/// its leaf's expiry); a failed download is remembered for a minute so a flood of bad URLs cannot make the API download
/// again and again. At most <see cref="MaxEntries"/> URLs are cached (the cache is emptied when full).
/// </summary>
internal sealed class HttpAlexaCertificateChainProvider(
    IHttpClientFactory httpClients,
    IOptions<AlexaOptions> options,
    TimeProvider timeProvider,
    ILogger<HttpAlexaCertificateChainProvider> logger) : IAlexaCertificateChainProvider
{
    public const string HttpClientName = "AlexaCertificates";
    public const int MaxEntries = 32;
    private const int MaxCertificates = 10;
    private static readonly TimeSpan FailureCacheTime = TimeSpan.FromMinutes(1);

    private readonly ConcurrentDictionary<string, CachedChain> _cache = new(StringComparer.Ordinal);

    public async Task<X509Certificate2Collection?> GetAsync(Uri url, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(url);
        var now = timeProvider.GetUtcNow();
        if (_cache.TryGetValue(url.AbsoluteUri, out var cached) && cached.ExpiresAt > now)
        {
            return cached.Chain;
        }

        var chain = await DownloadAsync(url, cancellationToken);
        Remember(url.AbsoluteUri, new CachedChain(chain, ExpiryOf(chain, now)));
        return chain;
    }

    private async Task<X509Certificate2Collection?> DownloadAsync(Uri url, CancellationToken cancellationToken)
    {
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(options.Value.CertDownloadTimeoutSeconds));
            var client = httpClients.CreateClient(HttpClientName);
            using var response = await client.GetAsync(url, HttpCompletionOption.ResponseContentRead, timeout.Token);
            return response.IsSuccessStatusCode ? Parse(await response.Content.ReadAsStringAsync(timeout.Token)) : null;
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or OperationCanceledException or CryptographicException)
        {
            cancellationToken.ThrowIfCancellationRequested();
            logger.LogWarning("The Alexa certificate chain could not be downloaded: {Reason}", exception.GetType().Name);
            return null;
        }
    }

    private X509Certificate2Collection? Parse(string pem)
    {
        if (pem.Length > options.Value.CertMaxBytes)
        {
            return null;
        }

        var chain = new X509Certificate2Collection();
        chain.ImportFromPem(pem);
        return chain.Count is > 0 and <= MaxCertificates ? chain : null;
    }

    private DateTimeOffset ExpiryOf(X509Certificate2Collection? chain, DateTimeOffset now)
    {
        if (chain is null)
        {
            return now + FailureCacheTime;
        }

        var cacheUntil = now + TimeSpan.FromMinutes(options.Value.CertCacheMinutes);
        var leafExpiry = new DateTimeOffset(chain[0].NotAfter.ToUniversalTime(), TimeSpan.Zero);
        return leafExpiry < cacheUntil ? leafExpiry : cacheUntil;
    }

    private void Remember(string url, CachedChain entry)
    {
        if (_cache.Count >= MaxEntries)
        {
            _cache.Clear();
        }

        _cache[url] = entry;
    }

    private sealed record CachedChain(X509Certificate2Collection? Chain, DateTimeOffset ExpiresAt);
}
