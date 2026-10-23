using System.Diagnostics;
using System.Net;
using System.Text;
using Lotties.Application.AddressLookup;
using Lotties.Domain.Exceptions;
using Lotties.Infrastructure.AddressLookup;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.AddressLookup;

/// <summary>The upstream directory against a fake <see cref="HttpMessageHandler"/>: nothing here touches the network.</summary>
public sealed class HttpAddressDirectoryTests
{
    private const string BrasilApiBody = """{"cep":"01001000","state":"SP","city":"São Paulo","neighborhood":"Sé","street":"Praça da Sé","service":"open-cep","location":{"type":"Point","coordinates":{"longitude":"-46.6333","latitude":"-23.5505"}}}""";
    private const string ViaCepBody = """{"cep":"01001-000","logradouro":"Praça da Sé","complemento":"lado ímpar","bairro":"Sé","localidade":"São Paulo","uf":"SP"}""";

    private const string NominatimBody = """
        [
          {"lat":"-23.5617","lon":"-46.6559","name":"Clínica Exemplo","display_name":"Clínica Exemplo, Avenida Paulista, Bela Vista, São Paulo, Brasil",
           "address":{"road":"Avenida Paulista","house_number":"1000","suburb":"Bela Vista","city":"São Paulo","state":"São Paulo","ISO3166-2-lvl4":"BR-SP","postcode":"01310-100","country":"Brasil"}},
          {"lat":"abc","lon":"1","display_name":"No coordinates"},
          {"lat":"51.5","lon":"-0.12","display_name":"10 Downing Street, London, UK","address":{"road":"Downing Street","house_number":"10","town":"London","state":"England","country":"United Kingdom"}}
        ]
        """;

    private readonly ScriptedHandler _handler = new();
    private readonly CapturingLogger _logger = new();

    private HttpAddressDirectory Directory(Action<AddressLookupOptions>? configure = null)
    {
        var options = new AddressLookupOptions { NominatimMinIntervalMilliseconds = 0, ContactEmail = "ops@example.com" };
        configure?.Invoke(options);
        var services = new ServiceCollection();
        services.AddHttpClient(AddressLookupServiceCollectionExtensions.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => _handler);
        var factory = services.BuildServiceProvider().GetRequiredService<IHttpClientFactory>();
        return new HttpAddressDirectory(factory, Options.Create(options), TimeProvider.System, _logger);
    }

    [Fact]
    public async Task FindByCep_BrasilApiAnswers_ReturnsTheFieldsAndCoordinatesFromOneRequest()
    {
        _handler.On("brasilapi.com.br", HttpStatusCode.OK, BrasilApiBody);

        var address = await Directory().FindByCepAsync("01001000");

        Assert.Equal(new CepAddressResponse("01001000", "Praça da Sé", "Sé", "São Paulo", "SP", -23.5505, -46.6333, "brasilapi"), address);
        var request = Assert.Single(_handler.Requests);
        Assert.Equal("https://brasilapi.com.br/api/cep/v2/01001000", request.Uri);
    }

    [Fact]
    public async Task FindByCep_SendsAnIdentifyingUserAgentWithTheContact()
    {
        _handler.On("brasilapi.com.br", HttpStatusCode.OK, BrasilApiBody);

        await Directory().FindByCepAsync("01001000");

        var agent = Assert.Single(_handler.Requests).UserAgent;
        Assert.Contains("Lotties-baby-tracker/1.0", agent, StringComparison.Ordinal);
        Assert.Contains("ops@example.com", agent, StringComparison.Ordinal);
    }

    [Fact]
    public async Task FindByCep_TheSameCepTwice_AsksTheUpstreamOnce()
    {
        _handler.On("brasilapi.com.br", HttpStatusCode.OK, BrasilApiBody);
        var directory = Directory();

        var first = await directory.FindByCepAsync("01001000");
        var second = await directory.FindByCepAsync("01001000");

        Assert.Equal(first, second);
        Assert.Single(_handler.Requests);
    }

    [Fact]
    public async Task FindByCep_BrasilApiWithoutCoordinates_LeavesThemOut()
    {
        _handler.On("brasilapi.com.br", HttpStatusCode.OK, """{"cep":"01001000","state":"SP","city":"São Paulo","neighborhood":null,"street":"","location":{"type":"Point","coordinates":{}}}""");

        var address = await Directory().FindByCepAsync("01001000");

        Assert.Null(address.Latitude);
        Assert.Null(address.Longitude);
        Assert.Null(address.Street);
        Assert.Null(address.Neighborhood);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError, "oops")]
    [InlineData(HttpStatusCode.BadGateway, "")]
    [InlineData(HttpStatusCode.OK, "not json")]
    [InlineData(HttpStatusCode.OK, "[]")]
    public async Task FindByCep_BrasilApiFails_FallsBackToViaCep(HttpStatusCode status, string body)
    {
        _handler.On("brasilapi.com.br", status, body);
        _handler.On("viacep.com.br", HttpStatusCode.OK, ViaCepBody);

        var address = await Directory().FindByCepAsync("01001000");

        Assert.Equal(new CepAddressResponse("01001000", "Praça da Sé", "Sé", "São Paulo", "SP", null, null, "viacep"), address);
        Assert.Equal(["https://brasilapi.com.br/api/cep/v2/01001000", "https://viacep.com.br/ws/01001000/json/"], _handler.Requests.Select(request => request.Uri));
    }

    [Fact]
    public async Task FindByCep_BrasilApiUnreachable_FallsBackToViaCep()
    {
        _handler.Fail("brasilapi.com.br", new HttpRequestException("connection refused"));
        _handler.On("viacep.com.br", HttpStatusCode.OK, ViaCepBody);

        var address = await Directory().FindByCepAsync("01001000");

        Assert.Equal("viacep", address.Source);
    }

    [Fact]
    public async Task FindByCep_BrasilApiTimesOut_FallsBackToViaCep()
    {
        _handler.Delay("brasilapi.com.br", TimeSpan.FromSeconds(30));
        _handler.On("viacep.com.br", HttpStatusCode.OK, ViaCepBody);

        var address = await Directory(options => options.TimeoutSeconds = 1).FindByCepAsync("01001000");

        Assert.Equal("viacep", address.Source);
    }

    [Fact]
    public async Task FindByCep_BrasilApi404AndViaCepKnowsIt_ReturnsViaCep()
    {
        _handler.On("brasilapi.com.br", HttpStatusCode.NotFound, """{"name":"CepPromiseError"}""");
        _handler.On("viacep.com.br", HttpStatusCode.OK, ViaCepBody);

        var address = await Directory().FindByCepAsync("01001000");

        Assert.Equal("viacep", address.Source);
    }

    [Theory]
    [InlineData("""{"erro": true}""")]
    [InlineData("""{"erro": "true"}""")]
    public async Task FindByCep_NeitherKnowsTheCep_IsNotFoundAndRemembered(string viaCepBody)
    {
        _handler.On("brasilapi.com.br", HttpStatusCode.NotFound, "{}");
        _handler.On("viacep.com.br", HttpStatusCode.OK, viaCepBody);
        var directory = Directory();

        var first = await Assert.ThrowsAsync<AddressNotFoundException>(() => directory.FindByCepAsync("99999999"));
        var second = await Assert.ThrowsAsync<AddressNotFoundException>(() => directory.FindByCepAsync("99999999"));

        Assert.Equal("address_not_found", first.Code);
        Assert.Equal("address_not_found", second.Code);
        Assert.Equal(2, _handler.Requests.Count);
    }

    [Fact]
    public async Task FindByCep_BrasilApi404AndViaCepDown_IsNotFound()
    {
        _handler.On("brasilapi.com.br", HttpStatusCode.NotFound, "{}");
        _handler.On("viacep.com.br", HttpStatusCode.ServiceUnavailable, string.Empty);

        await Assert.ThrowsAsync<AddressNotFoundException>(() => Directory().FindByCepAsync("99999999"));
    }

    [Fact]
    public async Task FindByCep_EveryUpstreamFails_IsUnavailableAndNotRemembered()
    {
        _handler.On("brasilapi.com.br", HttpStatusCode.InternalServerError, string.Empty);
        _handler.Fail("viacep.com.br", new HttpRequestException("down"));
        var directory = Directory();

        var exception = await Assert.ThrowsAsync<AddressLookupUnavailableException>(() => directory.FindByCepAsync("01001000"));
        await Assert.ThrowsAsync<AddressLookupUnavailableException>(() => directory.FindByCepAsync("01001000"));

        Assert.Equal("address_lookup_unavailable", exception.Code);
        Assert.Equal(4, _handler.Requests.Count);
    }

    [Fact]
    public async Task Disabled_NothingLeavesTheServer()
    {
        var directory = Directory(options => options.Enabled = false);

        await Assert.ThrowsAsync<AddressLookupDisabledException>(() => directory.FindByCepAsync("01001000"));
        await Assert.ThrowsAsync<AddressLookupDisabledException>(() => directory.SearchPlacesAsync("Avenida Paulista", null));

        Assert.Empty(_handler.Requests);
    }

    [Fact]
    public async Task Search_ReturnsPlacesWithTheirPartsAndSkipsTheOnesWithoutCoordinates()
    {
        _handler.On("nominatim.openstreetmap.org", HttpStatusCode.OK, NominatimBody);

        var places = await Directory().SearchPlacesAsync("Clínica Exemplo Paulista", "pt-BR");

        Assert.Equal(2, places.Count);
        var first = places[0];
        Assert.Equal("Clínica Exemplo", first.Name);
        Assert.Equal("Avenida Paulista", first.Street);
        Assert.Equal("1000", first.HouseNumber);
        Assert.Equal("Bela Vista", first.Neighborhood);
        Assert.Equal("São Paulo", first.City);
        Assert.Equal("SP", first.State);
        Assert.Equal("01310-100", first.PostalCode);
        Assert.Equal(-23.5617, first.Latitude);
        Assert.Equal(-46.6559, first.Longitude);
        Assert.Equal("London", places[1].City);
        Assert.Equal("England", places[1].State);
        Assert.Null(places[1].Name);
    }

    [Fact]
    public async Task Search_AsksNominatimWithTheEncodedTextLanguageAndAnIdentifyingAgent()
    {
        _handler.On("nominatim.openstreetmap.org", HttpStatusCode.OK, "[]");

        await Directory().SearchPlacesAsync("Rua & Flores 10", "pt-BR");

        var request = Assert.Single(_handler.Requests);
        Assert.StartsWith("https://nominatim.openstreetmap.org/search?", request.Uri, StringComparison.Ordinal);
        Assert.Contains("q=Rua%20%26%20Flores%2010", request.Uri, StringComparison.Ordinal);
        Assert.Contains("format=jsonv2", request.Uri, StringComparison.Ordinal);
        Assert.Contains("addressdetails=1", request.Uri, StringComparison.Ordinal);
        Assert.Contains("limit=5", request.Uri, StringComparison.Ordinal);
        Assert.Contains("accept-language=pt-BR", request.Uri, StringComparison.Ordinal);
        Assert.Contains("Lotties-baby-tracker", request.UserAgent, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Search_TheSameTextTwice_AsksNominatimOnceEvenWithOtherCase()
    {
        _handler.On("nominatim.openstreetmap.org", HttpStatusCode.OK, NominatimBody);
        var directory = Directory();

        await directory.SearchPlacesAsync("Avenida Paulista", "en");
        await directory.SearchPlacesAsync("avenida paulista", "en");

        Assert.Single(_handler.Requests);
    }

    [Fact]
    public async Task Search_NothingMatches_IsAnEmptyList()
    {
        _handler.On("nominatim.openstreetmap.org", HttpStatusCode.OK, "[]");

        Assert.Empty(await Directory().SearchPlacesAsync("zzzz qqqq", null));
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests, "")]
    [InlineData(HttpStatusCode.Forbidden, "blocked")]
    [InlineData(HttpStatusCode.OK, "<html>")]
    [InlineData(HttpStatusCode.OK, "{}")]
    public async Task Search_UpstreamFailsOrIsUnreadable_IsUnavailable(HttpStatusCode status, string body)
    {
        _handler.On("nominatim.openstreetmap.org", status, body);

        await Assert.ThrowsAsync<AddressLookupUnavailableException>(() => Directory().SearchPlacesAsync("Avenida Paulista", null));
    }

    [Fact]
    public async Task Search_RequestsAreSpacedByTheConfiguredInterval()
    {
        _handler.On("nominatim.openstreetmap.org", HttpStatusCode.OK, "[]");
        var directory = Directory(options => options.NominatimMinIntervalMilliseconds = 400);

        await directory.SearchPlacesAsync("first search", null);
        await directory.SearchPlacesAsync("second search", null);

        var gap = _handler.Requests[1].At - _handler.Requests[0].At;
        Assert.True(gap >= TimeSpan.FromMilliseconds(350), $"Expected the requests at least 350 ms apart, got {gap.TotalMilliseconds} ms.");
    }

    [Fact]
    public async Task Failures_NeverLogTheTypedText()
    {
        _handler.On("brasilapi.com.br", HttpStatusCode.InternalServerError, "01001000");
        _handler.Fail("viacep.com.br", new HttpRequestException("failed for 01001000"));
        _handler.On("nominatim.openstreetmap.org", HttpStatusCode.TooManyRequests, "secret clinic");
        var directory = Directory();

        await Assert.ThrowsAsync<AddressLookupUnavailableException>(() => directory.FindByCepAsync("01001000"));
        await Assert.ThrowsAsync<AddressLookupUnavailableException>(() => directory.SearchPlacesAsync("secret clinic", null));

        Assert.NotEmpty(_logger.Messages);
        Assert.All(_logger.Messages, message =>
        {
            Assert.DoesNotContain("01001000", message, StringComparison.Ordinal);
            Assert.DoesNotContain("secret", message, StringComparison.OrdinalIgnoreCase);
        });
    }

    private sealed record Seen(string Uri, string UserAgent, DateTimeOffset At);

    private sealed class ScriptedHandler : HttpMessageHandler
    {
        private readonly Dictionary<string, Func<CancellationToken, Task<HttpResponseMessage>>> _hosts = new(StringComparer.Ordinal);
        private readonly object _gate = new();

        public List<Seen> Requests { get; } = [];

        public void On(string host, HttpStatusCode status, string body) =>
            _hosts[host] = _ => Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });

        public void Fail(string host, Exception exception) => _hosts[host] = _ => throw exception;

        public void Delay(string host, TimeSpan delay) =>
            _hosts[host] = async token =>
            {
                await Task.Delay(delay, token);
                return new HttpResponseMessage(HttpStatusCode.OK);
            };

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var uri = request.RequestUri!;
            lock (_gate)
            {
                Requests.Add(new Seen(uri.AbsoluteUri, request.Headers.UserAgent.ToString(), DateTimeOffset.UtcNow));
            }

            return _hosts.TryGetValue(uri.Host, out var respond)
                ? respond(cancellationToken)
                : throw new InvalidOperationException($"Unexpected request to {uri.Host}: tests must not reach the network.");
        }
    }

    private sealed class CapturingLogger : ILogger<HttpAddressDirectory>
    {
        public List<string> Messages { get; } = [];

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            Messages.Add(formatter(state, exception) + (exception is null ? string.Empty : exception.ToString()));
        }
    }
}

public sealed class AddressLookupOptionsValidatorTests
{
    private readonly AddressLookupOptionsValidator _validator = new();

    [Fact]
    public void Validate_Defaults_Succeed() => Assert.True(_validator.Validate(null, new AddressLookupOptions()).Succeeded);

    [Theory]
    [InlineData("")]
    [InlineData("brasilapi.com.br")]
    [InlineData("ftp://brasilapi.com.br")]
    [InlineData("https://brasilapi.com.br/?x=1")]
    public void Validate_BadBaseUrl_Fails(string url)
    {
        var result = _validator.Validate(null, new AddressLookupOptions { BrasilApiBaseUrl = url });

        Assert.True(result.Failed);
        Assert.Contains("BrasilApiBaseUrl", result.FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_NonPositiveLimitsAndNegativeInterval_Fail()
    {
        var result = _validator.Validate(null, new AddressLookupOptions { TimeoutSeconds = 0, CacheMaxEntries = -1, NominatimMinIntervalMilliseconds = -5 });

        Assert.Contains("TimeoutSeconds", result.FailureMessage, StringComparison.Ordinal);
        Assert.Contains("CacheMaxEntries", result.FailureMessage, StringComparison.Ordinal);
        Assert.Contains("NominatimMinIntervalMilliseconds", result.FailureMessage, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("no-at-sign")]
    [InlineData("a b@example.com")]
    [InlineData("a@example.com)\r\nX-Evil: 1")]
    public void Validate_ContactThatCannotGoInAHeader_Fails(string contact) =>
        Assert.True(_validator.Validate(null, new AddressLookupOptions { ContactEmail = contact }).Failed);

    [Fact]
    public void Validate_PlainContactOrNone_Succeeds()
    {
        Assert.True(_validator.Validate(null, new AddressLookupOptions { ContactEmail = "ops@example.com" }).Succeeded);
        Assert.True(_validator.Validate(null, new AddressLookupOptions { ContactEmail = " " }).Succeeded);
    }
}

public sealed class AnswerCacheTests
{
    [Fact]
    public void Set_PastTheCap_EmptiesTheCacheBeforeAdding()
    {
        var cache = new AnswerCache<string>(TimeProvider.System, TimeSpan.FromMinutes(5), maxEntries: 2);
        cache.Set("a", "1");
        cache.Set("b", "2");

        cache.Set("c", "3");

        Assert.False(cache.TryGet("a", out _));
        Assert.True(cache.TryGet("c", out var value));
        Assert.Equal("3", value);
    }

    [Fact]
    public async Task TryGet_AfterTheTimeToLive_MissesAndAFullCacheDropsExpiredFirst()
    {
        var cache = new AnswerCache<string>(TimeProvider.System, TimeSpan.FromMilliseconds(50), maxEntries: 2);
        cache.Set("old", "1");
        await Task.Delay(120);
        cache.Set("fresh", "2");

        Assert.False(cache.TryGet("old", out _));
        cache.Set("newer", "3");
        Assert.True(cache.TryGet("newer", out _));
        Assert.True(cache.TryGet("fresh", out _));
    }
}
