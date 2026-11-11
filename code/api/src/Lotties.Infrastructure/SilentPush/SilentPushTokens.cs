using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Lotties.Domain.SilentPush;
using Lotties.Infrastructure.Push;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.SilentPush;

/// <summary>Compact JSON Web Tokens (RFC 7519) signed by a caller-supplied function; nothing else of JWT is needed here.</summary>
internal static class CompactJwt
{
    public static string Create(IReadOnlyDictionary<string, object> header, IReadOnlyDictionary<string, object> claims, Func<byte[], byte[]> sign)
    {
        ArgumentNullException.ThrowIfNull(sign);
        var signingInput = $"{Base64Url.Encode(JsonSerializer.SerializeToUtf8Bytes(header))}.{Base64Url.Encode(JsonSerializer.SerializeToUtf8Bytes(claims))}";
        return $"{signingInput}.{Base64Url.Encode(sign(Encoding.ASCII.GetBytes(signingInput)))}";
    }
}

/// <summary>
/// The APNs provider token (docs/design/19-native-push.md section 5.1): an ES256 JWT with <c>kid</c> = key id, <c>iss</c> =
/// team id and <c>iat</c>, reused for <see cref="ReuseFor"/> (Apple refuses tokens older than an hour and refreshes more
/// often than every 20 minutes). Thread-safe.
/// </summary>
internal sealed class ApnsProviderToken(ApnsSigningKey key, TimeProvider time)
{
    public static readonly TimeSpan ReuseFor = TimeSpan.FromMinutes(30);

    private readonly object _gate = new();
    private string? _token;
    private DateTimeOffset _issuedAt;

    /// <summary>The current token, signed again once it is <see cref="ReuseFor"/> old or after <see cref="Invalidate"/>.</summary>
    public string Current()
    {
        lock (_gate)
        {
            var now = time.GetUtcNow();
            if (_token is null || now - _issuedAt >= ReuseFor)
            {
                _token = Sign(now);
                _issuedAt = now;
            }

            return _token;
        }
    }

    /// <summary>Apple said the token expired: the next <see cref="Current"/> signs a new one.</summary>
    public void Invalidate()
    {
        lock (_gate)
        {
            _token = null;
        }
    }

    private string Sign(DateTimeOffset now) => CompactJwt.Create(
        new Dictionary<string, object> { ["alg"] = "ES256", ["kid"] = key.KeyId },
        new Dictionary<string, object> { ["iss"] = key.TeamId, ["iat"] = now.ToUnixTimeSeconds() },
        input => key.Key.SignData(input, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
}

/// <summary>An OAuth access token for FCM, or why there is none.</summary>
internal sealed record GoogleAccessToken(string? Value, SilentPushOutcome Failure)
{
    public static GoogleAccessToken Of(string value) => new(value, SilentPushOutcome.Sent);

    public static GoogleAccessToken Failed(SilentPushOutcome failure) => new(null, failure);
}

/// <summary>
/// The FCM access token (docs/design/19-native-push.md section 5.2): an RS256 JWT of the service account (<c>iss</c> =
/// its e-mail, <c>scope</c> = Firebase messaging, <c>aud</c> = Google's token endpoint, an hour) exchanged at
/// <see cref="GoogleServiceAccount.TokenEndpoint"/>, kept until <see cref="RefreshBefore"/> before it expires. A refused
/// key (400/401) is a configuration error; a network failure or 5xx is retryable. One exchange at a time.
/// </summary>
internal sealed class GoogleAccessTokenSource(GoogleServiceAccount account, IHttpClientFactory httpClients, TimeProvider time, ILogger<GoogleAccessTokenSource> logger) : IDisposable
{
    /// <summary>The named HTTP client of the token exchange (timeout <c>SilentPush:SendTimeoutSeconds</c>, no request logging).</summary>
    public const string HttpClientName = "SilentPushOAuth";
    public const string Scope = "https://www.googleapis.com/auth/firebase.messaging";
    public static readonly TimeSpan RefreshBefore = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan AssertionLifetime = TimeSpan.FromHours(1);

    private readonly SemaphoreSlim _gate = new(1, 1);
    private string? _token;
    private DateTimeOffset _expiresAt;

    public async Task<GoogleAccessToken> GetAsync(CancellationToken cancellationToken = default)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            return _token is not null && time.GetUtcNow() < _expiresAt - RefreshBefore ? GoogleAccessToken.Of(_token) : await ExchangeAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>FCM answered 401: the next <see cref="GetAsync"/> exchanges again.</summary>
    public void Invalidate() => _token = null;

    public void Dispose() => _gate.Dispose();

    private async Task<GoogleAccessToken> ExchangeAsync(CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        using var response = await PostAssertionAsync(Assertion(now), cancellationToken);
        if (response is null || !response.IsSuccessStatusCode)
        {
            return Refused(response);
        }

        var body = await ReadTokenAsync(response, cancellationToken);
        return body is { AccessToken: { Length: > 0 } token, ExpiresIn: > 0 } ? Keep(token, now + TimeSpan.FromSeconds(body.ExpiresIn)) : Refused(response);
    }

    private static async Task<TokenResponse?> ReadTokenAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            return await response.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task<HttpResponseMessage?> PostAssertionAsync(string assertion, CancellationToken cancellationToken)
    {
        using var content = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "urn:ietf:params:oauth:grant-type:jwt-bearer",
            ["assertion"] = assertion,
        });
        try
        {
            return await httpClients.CreateClient(HttpClientName).PostAsync(GoogleServiceAccount.TokenEndpoint, content, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException || (exception is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            logger.LogWarning("FCM access token exchange failed: {ErrorType}", exception.GetType().Name);
            return null;
        }
    }

    private GoogleAccessToken Keep(string token, DateTimeOffset expiresAt)
    {
        _token = token;
        _expiresAt = expiresAt;
        return GoogleAccessToken.Of(token);
    }

    private GoogleAccessToken Refused(HttpResponseMessage? response)
    {
        var status = (int?)response?.StatusCode;
        var failure = status is null or 429 or >= 500 ? SilentPushOutcome.Retryable : SilentPushOutcome.ConfigurationError;
        logger.LogError("FCM access token exchange answered {StatusCode}; silent pushes to Android are not sent", status);
        return GoogleAccessToken.Failed(failure);
    }

    private string Assertion(DateTimeOffset now) => CompactJwt.Create(
        new Dictionary<string, object> { ["alg"] = "RS256", ["typ"] = "JWT" },
        new Dictionary<string, object>
        {
            ["iss"] = account.ClientEmail,
            ["scope"] = Scope,
            ["aud"] = GoogleServiceAccount.TokenEndpoint.AbsoluteUri,
            ["iat"] = now.ToUnixTimeSeconds(),
            ["exp"] = (now + AssertionLifetime).ToUnixTimeSeconds(),
        },
        input => account.Key.SignData(input, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));

    private sealed record TokenResponse
    {
        [JsonPropertyName("access_token")]
        public string? AccessToken { get; init; }

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; init; }
    }
}
