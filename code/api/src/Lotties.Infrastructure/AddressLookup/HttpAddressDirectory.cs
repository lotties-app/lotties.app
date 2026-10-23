using System.Net;
using System.Text.Json;
using Lotties.Application.AddressLookup;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.AddressLookup;

/// <summary>
/// The upstream address sources over one named <see cref="HttpClient"/> (<see cref="HttpClientName"/>): a CEP is asked of
/// BrasilAPI first and ViaCEP second; a free-text search goes to OpenStreetMap Nominatim, whose usage policy is kept
/// (an identifying <c>User-Agent</c>, at most one request per second for the whole server, results cached, a search only on
/// the user's request). Only the typed text is sent. The query text is never logged: this class logs the upstream and the
/// outcome only, and the host's own HTTP client logging for <see cref="AddressLookupServiceCollectionExtensions.HttpClientName"/> is turned off in appsettings.json
/// (it would print the request URL).
/// </summary>
internal sealed class HttpAddressDirectory : IAddressDirectory
{
    private const int MaxResponseBytes = 256 * 1024;
    private const string ProjectUrl = "https://github.com/dev-vinicius-andrade/baby-routine";

    private enum CepOutcome
    {
        Found,
        NotFound,
        Failed,
    }

    private readonly IHttpClientFactory _clients;
    private readonly AddressLookupOptions _options;
    private readonly TimeProvider _time;
    private readonly ILogger<HttpAddressDirectory> _logger;
    private readonly AnswerCache<CepAddressResponse?> _cepCache;
    private readonly AnswerCache<IReadOnlyList<PlaceResult>> _searchCache;
    private readonly SemaphoreSlim _nominatimGate = new(1, 1);
    private readonly string _userAgent;
    private DateTimeOffset _nextNominatimRequest = DateTimeOffset.MinValue;

    public HttpAddressDirectory(IHttpClientFactory clients, IOptions<AddressLookupOptions> options, TimeProvider time, ILogger<HttpAddressDirectory> logger)
    {
        _clients = clients;
        _options = options.Value;
        _time = time;
        _logger = logger;
        _cepCache = new AnswerCache<CepAddressResponse?>(time, TimeSpan.FromMinutes(_options.CepCacheMinutes), _options.CacheMaxEntries);
        _searchCache = new AnswerCache<IReadOnlyList<PlaceResult>>(time, TimeSpan.FromMinutes(_options.SearchCacheMinutes), _options.CacheMaxEntries);
        var contact = string.IsNullOrWhiteSpace(_options.ContactEmail) ? ProjectUrl : $"{ProjectUrl}; {_options.ContactEmail.Trim()}";
        _userAgent = $"Lotties-baby-tracker/1.0 (+{contact})";
    }

    public async Task<CepAddressResponse> FindByCepAsync(string cep, CancellationToken cancellationToken = default)
    {
        EnsureEnabled();
        if (_cepCache.TryGet(cep, out var cached))
        {
            return cached ?? throw new AddressNotFoundException();
        }

        var (first, firstAddress) = await AskBrasilApiAsync(cep, cancellationToken);
        if (first == CepOutcome.Found)
        {
            _cepCache.Set(cep, firstAddress);
            return firstAddress!;
        }

        var (second, secondAddress) = await AskViaCepAsync(cep, cancellationToken);
        if (second == CepOutcome.Found)
        {
            _cepCache.Set(cep, secondAddress);
            return secondAddress!;
        }

        if (first == CepOutcome.Failed && second == CepOutcome.Failed)
        {
            throw new AddressLookupUnavailableException();
        }

        _cepCache.Set(cep, null);
        throw new AddressNotFoundException();
    }

    public async Task<IReadOnlyList<PlaceResult>> SearchPlacesAsync(string query, string? language, CancellationToken cancellationToken = default)
    {
        EnsureEnabled();
        var key = $"{language?.ToLowerInvariant()}|{query.ToLowerInvariant()}";
        if (_searchCache.TryGet(key, out var cached))
        {
            return cached;
        }

        await WaitForNominatimSlotAsync(cancellationToken);
        var url = $"{Base(_options.NominatimBaseUrl)}/search?format=jsonv2&addressdetails=1&limit={AddressQueryRules.MaxResults}&q={Uri.EscapeDataString(query)}"
            + (language is null ? string.Empty : $"&accept-language={Uri.EscapeDataString(language)}");
        var answer = await GetAsync("nominatim", new Uri(url), cancellationToken);
        if (answer is not { Status: HttpStatusCode.OK })
        {
            throw new AddressLookupUnavailableException();
        }

        try
        {
            var places = AddressParsers.ParseNominatim(answer.Value.Body);
            _searchCache.Set(key, places);
            return places;
        }
        catch (JsonException exception)
        {
            _logger.LogWarning("Address upstream {Upstream} answered something unreadable ({ErrorType})", "nominatim", exception.GetType().Name);
            throw new AddressLookupUnavailableException(exception);
        }
    }

    private void EnsureEnabled()
    {
        if (!_options.Enabled)
        {
            throw new AddressLookupDisabledException();
        }
    }

    private async Task<(CepOutcome Outcome, CepAddressResponse? Address)> AskBrasilApiAsync(string cep, CancellationToken cancellationToken)
    {
        var answer = await GetAsync("brasilapi", new Uri($"{Base(_options.BrasilApiBaseUrl)}/api/cep/v2/{cep}"), cancellationToken);
        switch (answer)
        {
            case { Status: HttpStatusCode.OK }:
                try
                {
                    return (CepOutcome.Found, AddressParsers.ParseBrasilApi(answer.Value.Body, cep));
                }
                catch (JsonException)
                {
                    return (CepOutcome.Failed, null);
                }

            case { Status: HttpStatusCode.NotFound }:
                return (CepOutcome.NotFound, null);
            default:
                return (CepOutcome.Failed, null);
        }
    }

    private async Task<(CepOutcome Outcome, CepAddressResponse? Address)> AskViaCepAsync(string cep, CancellationToken cancellationToken)
    {
        var answer = await GetAsync("viacep", new Uri($"{Base(_options.ViaCepBaseUrl)}/ws/{cep}/json/"), cancellationToken);
        if (answer is not { Status: HttpStatusCode.OK })
        {
            return (answer is { Status: HttpStatusCode.NotFound } ? CepOutcome.NotFound : CepOutcome.Failed, null);
        }

        try
        {
            return AddressParsers.ParseViaCep(answer.Value.Body, cep) is { } address ? (CepOutcome.Found, address) : (CepOutcome.NotFound, null);
        }
        catch (JsonException)
        {
            return (CepOutcome.Failed, null);
        }
    }

    /// <summary>
    /// Spaces this server's Nominatim requests by <see cref="AddressLookupOptions.NominatimMinIntervalMilliseconds"/>, whoever asks.
    /// A request that cannot get a slot within the timeout is a busy server: the caller keeps the manual field.
    /// </summary>
    private async Task WaitForNominatimSlotAsync(CancellationToken cancellationToken)
    {
        if (!await _nominatimGate.WaitAsync(TimeSpan.FromSeconds(_options.TimeoutSeconds), cancellationToken))
        {
            _logger.LogInformation("Address upstream {Upstream} is busy; the request was refused", "nominatim");
            throw new AddressLookupUnavailableException();
        }

        try
        {
            var wait = _nextNominatimRequest - _time.GetUtcNow();
            if (wait > TimeSpan.Zero)
            {
                await Task.Delay(wait, _time, cancellationToken);
            }

            _nextNominatimRequest = _time.GetUtcNow() + TimeSpan.FromMilliseconds(_options.NominatimMinIntervalMilliseconds);
        }
        finally
        {
            _nominatimGate.Release();
        }
    }

    private async Task<(HttpStatusCode Status, string Body)?> GetAsync(string upstream, Uri uri, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(_options.TimeoutSeconds));
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, uri);
            request.Headers.TryAddWithoutValidation("User-Agent", _userAgent);
            request.Headers.TryAddWithoutValidation("Accept", "application/json");
            using var response = await _clients.CreateClient(AddressLookupServiceCollectionExtensions.HttpClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            var body = await response.Content.ReadAsStringAsync(timeout.Token);
            if (!response.IsSuccessStatusCode && response.StatusCode != HttpStatusCode.NotFound)
            {
                _logger.LogWarning("Address upstream {Upstream} answered {StatusCode}", upstream, (int)response.StatusCode);
            }

            return (response.StatusCode, body);
        }
        catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException && !cancellationToken.IsCancellationRequested)
        {
            _logger.LogWarning("Address upstream {Upstream} did not answer ({ErrorType})", upstream, exception.GetType().Name);
            return null;
        }
    }

    private static string Base(string url) => url.TrimEnd('/');

    internal static long MaxResponseBufferBytes => MaxResponseBytes;
}
