using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Board;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Board;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using ModelContextProtocol.Client;

namespace Lotties.Api.Tests.Board;

/// <summary>
/// The test API with the board's MCP endpoint on, and the API's real JWT bearer validation as the default scheme (a test
/// issuer whose signing key lives here), so a Keycloak user is a real access token (audience <see cref="ApiAudience"/>,
/// Keycloak's <c>realm_access</c> claim) and a board key goes through the real board guard. The baby-data MCP server is on
/// too, so the two endpoints can be tried against each other's credentials. Clients are the official SDK's or raw HTTP.
/// </summary>
public sealed class BoardMcpHost : IDisposable
{
    public const string Issuer = "https://id.lotties.test/realms/lotties.app";
    public const string ApiAudience = "lotties-api";
    public const string Path = "/api/v1/board/mcp";
    public const string BabyMcpPath = "/api/v1/mcp";
    public const string LegacyProtocol = "2025-11-25";
    public const string ModernProtocol = "2026-07-28";

    private readonly RSA _signingKey = RSA.Create(2048);

    public BoardMcpHost()
        : this([], null)
    {
    }

    private BoardMcpHost(IReadOnlyList<(string Key, string Value)> settings, Action<IServiceCollection>? services)
    {
        Factory = new ApiFactory();
        Host = Factory.WithWebHostBuilder(builder => Configure(builder, settings, services));
    }

    internal ApiFactory Factory { get; }

    internal WebApplicationFactory<Program> Host { get; }

    private SecurityKey Key => new RsaSecurityKey(_signingKey) { KeyId = "test-key" };

    /// <summary>A host with extra settings (a low limit, the endpoint off); dispose it after the test.</summary>
    internal static BoardMcpHost With(params (string Key, string Value)[] settings) => new(settings, null);

    /// <summary>A host with extra test services (a log capture); dispose it after the test.</summary>
    internal static BoardMcpHost WithServices(Action<IServiceCollection> services) => new([], services);

    public void Dispose()
    {
        Host.Dispose();
        Factory.Dispose();
        _signingKey.Dispose();
    }

    /// <summary>A board API key seeded in the database this host shares with <see cref="Factory"/>; returns its secret.</summary>
    internal Task<string> KeyAsync(BoardKeyScope scope, IReadOnlyList<string>? topics = null, bool revoked = false, bool expired = false, string name = "Claude Code test key") =>
        Factory.SeedKeyAsync(scope, topics, revoked, expired, name);

    /// <summary>A Keycloak access token of the web app's client: the API audience, <paramref name="roles"/> in <c>realm_access</c>.</summary>
    internal string UserToken(string subject, string? roles, string audience = ApiAudience, string? scope = null, string name = "Board Person", DateTimeOffset? expires = null)
    {
        var until = expires ?? DateTimeOffset.UtcNow.AddMinutes(5);
        var claims = new Dictionary<string, object> { ["name"] = name };
        if (roles is not null)
        {
            claims["realm_access"] = new Dictionary<string, object> { ["roles"] = roles.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) };
        }

        if (scope is not null)
        {
            claims["scope"] = scope;
        }

        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = audience,
            Subject = new ClaimsIdentity([new Claim("sub", subject)]),
            Claims = claims,
            IssuedAt = until.UtcDateTime.AddHours(-1),
            NotBefore = until.UtcDateTime.AddHours(-1),
            Expires = until.UtcDateTime,
            SigningCredentials = new SigningCredentials(Key, SecurityAlgorithms.RsaSha256),
        });
    }

    /// <summary>An HTTP client of the test server presenting <paramref name="bearer"/> (none when <c>null</c>), or the key in <c>X-Board-Key</c>.</summary>
    internal HttpClient HttpFor(string? bearer, bool inBoardKeyHeader = false)
    {
        var client = Host.CreateClient();
        if (bearer is not null && inBoardKeyHeader)
        {
            client.DefaultRequestHeaders.Add(BoardKeyAuthenticationHandler.HeaderName, bearer);
        }
        else if (bearer is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        }

        return client;
    }

    /// <summary>The official SDK client connected to the board endpoint, speaking <paramref name="protocolVersion"/> (latest by default).</summary>
    internal async Task<McpClient> ClientAsync(string bearer, string? protocolVersion = null, bool inBoardKeyHeader = false)
    {
        var http = HttpFor(bearer, inBoardKeyHeader);
        var transport = new HttpClientTransport(
            new HttpClientTransportOptions { Endpoint = new Uri(http.BaseAddress!, Path), TransportMode = HttpTransportMode.StreamableHttp },
            http,
            NullLoggerFactory.Instance,
            ownsHttpClient: true);
        // No separate 5 s server/discover probe, as in McpApiHost: a fresh host's first request in the parallel suite can be
        // slower, and the cancelled probe came back as a 499.
        var options = new McpClientOptions
        {
            ClientInfo = new() { Name = "lotties-board-tests", Version = "1.0" },
            ProtocolVersion = protocolVersion,
            DiscoverProbeTimeout = Timeout.InfiniteTimeSpan,
        };
        return await McpClient.CreateAsync(transport, options, NullLoggerFactory.Instance);
    }

    /// <summary>A raw JSON-RPC POST (legacy era headers) to <paramref name="path"/>, for the HTTP-level checks the SDK client hides.</summary>
    internal Task<HttpResponseMessage> PostAsync(string? bearer, string body, string path = Path, bool inBoardKeyHeader = false, params (string Name, string Value)[] headers)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.Accept.ParseAdd("text/event-stream");
        request.Headers.TryAddWithoutValidation("MCP-Protocol-Version", LegacyProtocol);
        foreach (var (name, value) in headers)
        {
            request.Headers.TryAddWithoutValidation(name, value);
        }

        return HttpFor(bearer, inBoardKeyHeader).SendAsync(request);
    }

    /// <summary>The JSON-RPC message of a response, whether the server answered with JSON or one SSE event.</summary>
    internal static async Task<JsonElement> MessageOf(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        var json = text.TrimStart().StartsWith('{')
            ? text
            : string.Concat(text.Split('\n').Where(line => line.StartsWith("data:", StringComparison.Ordinal)).Select(line => line["data:".Length..].Trim()));
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    private void Configure(IWebHostBuilder builder, IReadOnlyList<(string Key, string Value)> settings, Action<IServiceCollection>? extra)
    {
        builder.UseSetting("Mcp:Enabled", "true");
        builder.UseSetting("Board:Mcp:Enabled", "true");
        builder.UseSetting("Auth:Authority", Issuer);
        builder.UseSetting("Auth:Audience", ApiAudience);
        builder.UseSetting("RequestLimits:BoardPermitsPerMinute", "1000");
        builder.UseSetting("RequestLimits:PermitsPerMinute", "1000");
        foreach (var (key, value) in settings)
        {
            builder.UseSetting(key, value);
        }

        builder.ConfigureTestServices(services =>
        {
            services.ConfigureAll<JwtBearerOptions>(options => options.Configuration = TestIssuerConfiguration());
            services.PostConfigure<AuthenticationOptions>(UseTheApisJwtScheme);
            extra?.Invoke(services);
        });
    }

    /// <summary>Undoes the test factory's header scheme: users authenticate with real access tokens, as in production.</summary>
    private static void UseTheApisJwtScheme(AuthenticationOptions options)
    {
        options.DefaultScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
        options.DefaultForbidScheme = JwtBearerDefaults.AuthenticationScheme;
    }

    private OpenIdConnectConfiguration TestIssuerConfiguration()
    {
        var configuration = new OpenIdConnectConfiguration { Issuer = Issuer };
        configuration.SigningKeys.Add(Key);
        return configuration;
    }
}

/// <summary>Raw JSON-RPC bodies (2025-11-25 shape) for the board endpoint's HTTP-level tests.</summary>
internal static class BoardMcpMessages
{
    public static string Initialize(int id = 1) => JsonSerializer.Serialize(new
    {
        jsonrpc = "2.0",
        id,
        method = "initialize",
        @params = new { protocolVersion = BoardMcpHost.LegacyProtocol, capabilities = new { }, clientInfo = new { name = "raw", version = "1" } },
    });

    public static string ListTools(int id = 2) => JsonSerializer.Serialize(new { jsonrpc = "2.0", id, method = "tools/list", @params = new { } });

    public static string Call(string tool, string arguments = "{}", int id = 3) => JsonSerializer.Serialize(new
    {
        jsonrpc = "2.0",
        id,
        method = "tools/call",
        @params = new { name = tool, arguments = JsonDocument.Parse(arguments).RootElement },
    });

    /// <summary>The MCP scope of the baby-data server, to make a baby MCP token.</summary>
    public const string BabyReadScope = McpScopes.Read;

    /// <summary>The baby-data MCP token audience.</summary>
    public const string BabyAudience = McpOptions.DefaultAudience;
}
