using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Limits;
using Lotties.Api.Tests.Support;
using Lotties.Application.AddressLookup;
using Lotties.Domain.Exceptions;
using Lotties.Infrastructure.AddressLookup;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Endpoints;

/// <summary>
/// <c>/address/lookup</c> and <c>/address/search</c> (docs/design/23-address-lookup.md): authentication, input validation,
/// the typed errors, the per-user rate limit, and the real wiring over a fake upstream HTTP handler. Nothing here reaches
/// the network (<see cref="NoNetworkHandler"/> guards every test host).
/// </summary>
public sealed class AddressEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly CepAddressResponse Sample = new("01001000", "Praça da Sé", "Sé", "São Paulo", "SP", null, null, "brasilapi");

    private readonly FakeDirectory _directory = new();

    private HttpClient Client(WebApplicationFactory<Program>? host = null, string? subject = null)
    {
        var client = (host ?? WithDirectory()).CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject ?? TestUsers.NewSubject());
        return client;
    }

    private WebApplicationFactory<Program> WithDirectory(params (string Key, string Value)[] settings) =>
        factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(settings.Select(setting => KeyValuePair.Create(setting.Key, (string?)setting.Value))));
            builder.ConfigureTestServices(services => services.AddSingleton<IAddressDirectory>(_directory));
        });

    [Theory]
    [InlineData("/api/v1/address/lookup?cep=01001000")]
    [InlineData("/api/v1/address/search?q=avenida%20paulista")]
    public async Task Routes_Anonymous_Are401(string path)
    {
        var response = await WithDirectory().CreateClient().GetAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Empty(_directory.Calls);
    }

    [Fact]
    public async Task Lookup_SignedInUserWithoutAnyBaby_GetsTheAddress()
    {
        _directory.Cep = Sample;

        var response = await Client().GetAsync("/api/v1/address/lookup?cep=01001-000");

        var body = await response.ReadAsync<JsonElement>();
        Assert.Equal("Praça da Sé", body.GetProperty("street").GetString());
        Assert.Equal("Sé", body.GetProperty("neighborhood").GetString());
        Assert.Equal("São Paulo", body.GetProperty("city").GetString());
        Assert.Equal("SP", body.GetProperty("state").GetString());
        Assert.Equal("brasilapi", body.GetProperty("source").GetString());
        Assert.Equal(["01001000"], _directory.Calls);
    }

    [Theory]
    [InlineData("")]
    [InlineData("123")]
    [InlineData("0100100")]
    [InlineData("010010000")]
    [InlineData("abcdefgh")]
    [InlineData("01001_000")]
    [InlineData("0100-1000")]
    public async Task Lookup_MalformedCep_Is400ValidationOnTheCepFieldAndNothingIsAsked(string cep)
    {
        var response = await Client().GetAsync($"/api/v1/address/lookup?cep={Uri.EscapeDataString(cep)}");

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("cep", problem.GetProperty("field").GetString());
        Assert.Empty(_directory.Calls);
    }

    [Fact]
    public async Task Lookup_NoCepParameter_Is400()
    {
        var response = await Client().GetAsync("/api/v1/address/lookup");

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Lookup_UnknownCep_Is404AddressNotFound()
    {
        _directory.Failure = new AddressNotFoundException();

        var response = await Client().GetAsync("/api/v1/address/lookup?cep=99999999");

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "address_not_found");
    }

    [Fact]
    public async Task Lookup_UpstreamsDown_Is502Unavailable()
    {
        _directory.Failure = new AddressLookupUnavailableException();

        var response = await Client().GetAsync("/api/v1/address/lookup?cep=01001000");

        await response.AssertProblemAsync(HttpStatusCode.BadGateway, "address_lookup_unavailable");
    }

    [Fact]
    public async Task Lookup_TurnedOff_Is503Disabled()
    {
        _directory.Failure = new AddressLookupDisabledException();

        var response = await Client().GetAsync("/api/v1/address/lookup?cep=01001000");

        await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "address_lookup_disabled");
    }

    [Fact]
    public async Task Search_ReturnsThePlacesAndCollapsesTheWhitespaceOfTheText()
    {
        _directory.Places = [new PlaceResult("Clinic, Rua A, Sao Paulo", "Clinic", "Rua A", "10", "Centro", "Sao Paulo", "SP", "01000-000", "Brasil", -23.5, -46.6)];

        var response = await Client().GetAsync("/api/v1/address/search?q=%20%20clinic%20%20rua%20a%20&lang=pt-BR");

        var body = await response.ReadAsync<JsonElement>();
        var place = Assert.Single(body.GetProperty("results").EnumerateArray());
        Assert.Equal("Rua A", place.GetProperty("street").GetString());
        Assert.Equal(-23.5, place.GetProperty("latitude").GetDouble());
        Assert.Equal(["clinic rua a|pt-BR"], _directory.Calls);
    }

    [Fact]
    public async Task Search_NothingMatches_IsAnEmptyList()
    {
        var response = await Client().GetAsync("/api/v1/address/search?q=nowhere%20land");

        var body = await response.ReadAsync<JsonElement>();
        Assert.Equal(0, body.GetProperty("results").GetArrayLength());
    }

    [Theory]
    [InlineData("q=", "q")]
    [InlineData("q=ab", "q")]
    [InlineData("q=%20%20%20", "q")]
    [InlineData("q=abc%00def", "q")]
    [InlineData("q=avenida&lang=not%20a%20tag", "lang")]
    [InlineData("q=avenida&lang=en%0d%0aX-Evil", "lang")]
    public async Task Search_InvalidInput_Is400OnTheOffendingField(string query, string field)
    {
        var response = await Client().GetAsync($"/api/v1/address/search?{query}");

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
        Assert.Empty(_directory.Calls);
    }

    [Fact]
    public async Task Search_TextLongerThan120Characters_Is400()
    {
        var response = await Client().GetAsync($"/api/v1/address/search?q={new string('a', 121)}");

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Search_TextOf120Characters_IsAccepted()
    {
        var response = await Client().GetAsync($"/api/v1/address/search?q={new string('a', 120)}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Search_UpstreamDown_Is502Unavailable()
    {
        _directory.Failure = new AddressLookupUnavailableException();

        var response = await Client().GetAsync("/api/v1/address/search?q=avenida%20paulista");

        await response.AssertProblemAsync(HttpStatusCode.BadGateway, "address_lookup_unavailable");
    }

    [Fact]
    public async Task Routes_MoreThanThePermitsPerMinute_Are429WithRetryAfterPerUser()
    {
        using var limited = WithDirectory(("RequestLimits:AddressLookupPermitsPerMinute", "2"));
        var client = Client(limited, TestUsers.NewSubject());

        var accepted = new[] { await client.GetAsync("/api/v1/address/lookup?cep=01001000"), await client.GetAsync("/api/v1/address/search?q=avenida") };
        var rejected = await client.GetAsync("/api/v1/address/lookup?cep=01001000");
        var otherUser = await Client(limited).GetAsync("/api/v1/address/lookup?cep=01001000");

        Assert.All(accepted, response => Assert.Equal(HttpStatusCode.OK, response.StatusCode));
        await rejected.AssertProblemAsync(HttpStatusCode.TooManyRequests, UserRateLimits.ErrorCode);
        Assert.True(rejected.Headers.Contains("Retry-After"));
        Assert.Equal(HttpStatusCode.OK, otherUser.StatusCode);
        Assert.Equal(3, _directory.Calls.Count);
    }

    [Fact]
    public async Task EndToEnd_CepFallsBackToViaCepAndNominatimIsSpaced_OverAFakeUpstream()
    {
        var upstream = new ScriptedUpstream();
        upstream.On("brasilapi.com.br", HttpStatusCode.ServiceUnavailable, "{}");
        upstream.On("viacep.com.br", HttpStatusCode.OK, """{"cep":"01001-000","logradouro":"Praça da Sé","bairro":"Sé","localidade":"São Paulo","uf":"SP"}""");
        upstream.On("nominatim.openstreetmap.org", HttpStatusCode.OK, """[{"lat":"-23.5","lon":"-46.6","display_name":"Praça da Sé, São Paulo","address":{"road":"Praça da Sé","city":"São Paulo","state":"São Paulo","ISO3166-2-lvl4":"BR-SP"}}]""");
        var host = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["AddressLookup:NominatimMinIntervalMilliseconds"] = "0" }));
            builder.ConfigureTestServices(services =>
                services.AddHttpClient(AddressLookupServiceCollectionExtensions.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => upstream));
        });
        var client = Client(host);

        var cep = await (await client.GetAsync("/api/v1/address/lookup?cep=01001-000")).ReadAsync<JsonElement>();
        var search = await (await client.GetAsync("/api/v1/address/search?q=Pra%C3%A7a%20da%20S%C3%A9")).ReadAsync<JsonElement>();

        Assert.Equal("viacep", cep.GetProperty("source").GetString());
        Assert.Equal("SP", search.GetProperty("results")[0].GetProperty("state").GetString());
        Assert.Equal(["brasilapi.com.br", "viacep.com.br", "nominatim.openstreetmap.org"], upstream.Hosts);
        Assert.All(upstream.UserAgents, agent => Assert.Contains("Lotties-baby-tracker", agent, StringComparison.Ordinal));
    }

    [Fact]
    public async Task EndToEnd_AddressLookupSwitchedOff_Is503AndNothingIsCalled()
    {
        var upstream = new ScriptedUpstream();
        var host = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["AddressLookup:Enabled"] = "false" }));
            builder.ConfigureTestServices(services =>
                services.AddHttpClient(AddressLookupServiceCollectionExtensions.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => upstream));
        });

        var response = await Client(host).GetAsync("/api/v1/address/lookup?cep=01001000");

        await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "address_lookup_disabled");
        Assert.Empty(upstream.Hosts);
    }

    private sealed class FakeDirectory : IAddressDirectory
    {
        public List<string> Calls { get; } = [];

        public CepAddressResponse Cep { get; set; } = Sample;

        public IReadOnlyList<PlaceResult> Places { get; set; } = [];

        public Exception? Failure { get; set; }

        public Task<CepAddressResponse> FindByCepAsync(string cep, CancellationToken cancellationToken = default)
        {
            Calls.Add(cep);
            return Failure is null ? Task.FromResult(Cep) : Task.FromException<CepAddressResponse>(Failure);
        }

        public Task<IReadOnlyList<PlaceResult>> SearchPlacesAsync(string query, string? language, CancellationToken cancellationToken = default)
        {
            Calls.Add($"{query}|{language}");
            return Failure is null ? Task.FromResult(Places) : Task.FromException<IReadOnlyList<PlaceResult>>(Failure);
        }
    }

    private sealed class ScriptedUpstream : HttpMessageHandler
    {
        private readonly Dictionary<string, (HttpStatusCode Status, string Body)> _answers = new(StringComparer.Ordinal);

        public List<string> Hosts { get; } = [];

        public List<string> UserAgents { get; } = [];

        public void On(string host, HttpStatusCode status, string body) => _answers[host] = (status, body);

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var host = request.RequestUri!.Host;
            Hosts.Add(host);
            UserAgents.Add(request.Headers.UserAgent.ToString());
            var (status, body) = _answers[host];
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
        }
    }
}
