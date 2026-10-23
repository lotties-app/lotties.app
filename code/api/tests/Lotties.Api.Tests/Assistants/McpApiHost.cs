using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Tests.Support;
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

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The test API with the MCP server enabled and OIDC configured for a test issuer whose signing key lives here (the discovery
/// document is replaced by a static configuration, so the real JWT bearer validation runs: issuer, audience, lifetime,
/// signature, <c>sub</c>). Tokens are made as Keycloak would issue them to an AI client: audience <see cref="Audience"/> and
/// the granted scopes in the space-separated <c>scope</c> claim. Clients are the official SDK's (both protocol eras) or raw HTTP;
/// nothing leaves the process.
/// </summary>
public sealed class McpApiHost : IDisposable
{
    public const string Issuer = "https://id.lotties.test/realms/lotties.app";
    public const string ApiAudience = "lotties-api";
    public const string Audience = McpOptions.DefaultAudience;
    public const string Path = "/api/v1/mcp";
    public const string LegacyProtocol = "2025-11-25";
    public const string ModernProtocol = "2026-07-28";
    public const string ReadWrite = $"{McpScopes.Read} {McpScopes.Write}";

    private readonly RSA _signingKey = RSA.Create(2048);

    public McpApiHost()
        : this([], null)
    {
    }

    private McpApiHost(IReadOnlyList<(string Key, string Value)> settings, Action<IServiceCollection>? services)
    {
        Factory = new ApiFactory();
        Host = Factory.WithWebHostBuilder(builder => Configure(builder, settings, services));
    }

    internal ApiFactory Factory { get; }

    internal WebApplicationFactory<Program> Host { get; }

    internal SecurityKey Key => new RsaSecurityKey(_signingKey) { KeyId = "test-key" };

    /// <summary>A host with extra settings (a low limit, allowed origins); dispose it after the test.</summary>
    internal static McpApiHost With(params (string Key, string Value)[] settings) => new(settings, null);

    /// <summary>A host with extra test services (a log capture); dispose it after the test.</summary>
    internal static McpApiHost WithServices(Action<IServiceCollection> services) => new([], services);

    public void Dispose()
    {
        Host.Dispose();
        Factory.Dispose();
        _signingKey.Dispose();
    }

    /// <summary>An access token for <paramref name="subject"/> granting <paramref name="scope"/> (space-separated; <c>null</c> for no scope claim).</summary>
    internal string TokenFor(string subject, string? scope = McpScopes.Read, string audience = Audience, DateTimeOffset? expires = null, string issuer = Issuer, SecurityKey? key = null)
    {
        var until = expires ?? DateTimeOffset.UtcNow.AddMinutes(5);
        var claims = new List<Claim> { new("sub", subject) };
        if (scope is not null)
        {
            claims.Add(new Claim("scope", scope));
        }

        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            Subject = new ClaimsIdentity(claims),
            IssuedAt = until.UtcDateTime.AddHours(-1),
            NotBefore = until.UtcDateTime.AddHours(-1),
            Expires = until.UtcDateTime,
            SigningCredentials = new SigningCredentials(key ?? Key, SecurityAlgorithms.RsaSha256),
        });
    }

    /// <summary>An HTTP client of the test server with <paramref name="token"/> as its bearer token (none when <c>null</c>).</summary>
    internal HttpClient HttpFor(string? token)
    {
        var client = Host.CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return client;
    }

    /// <summary>The official SDK client connected to the endpoint with <paramref name="token"/>, speaking <paramref name="protocolVersion"/> (latest by default).</summary>
    internal async Task<McpClient> ClientAsync(string token, string? protocolVersion = null)
    {
        var http = HttpFor(token);
        var transport = new HttpClientTransport(
            new HttpClientTransportOptions { Endpoint = new Uri(http.BaseAddress!, Path), TransportMode = HttpTransportMode.StreamableHttp },
            http,
            NullLoggerFactory.Instance,
            ownsHttpClient: true);
        var options = new McpClientOptions { ClientInfo = new() { Name = "lotties-tests", Version = "1.0" }, ProtocolVersion = protocolVersion };
        return await McpClient.CreateAsync(transport, options, NullLoggerFactory.Instance);
    }

    /// <summary>A raw JSON-RPC POST to the endpoint (legacy era headers), for the HTTP-level checks the SDK client hides.</summary>
    internal Task<HttpResponseMessage> PostAsync(string? token, string body, params (string Name, string Value)[] headers)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, Path) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Accept.ParseAdd("application/json");
        request.Headers.Accept.ParseAdd("text/event-stream");
        request.Headers.TryAddWithoutValidation("MCP-Protocol-Version", LegacyProtocol);
        foreach (var (name, value) in headers)
        {
            request.Headers.TryAddWithoutValidation(name, value);
        }

        return HttpFor(token).SendAsync(request);
    }

    private void Configure(IWebHostBuilder builder, IReadOnlyList<(string Key, string Value)> settings, Action<IServiceCollection>? extra)
    {
        builder.UseSetting("Mcp:Enabled", "true");
        builder.UseSetting("Auth:Authority", Issuer);
        builder.UseSetting("Auth:Audience", ApiAudience);
        builder.UseSetting("RequestLimits:AssistantPermitsPerMinute", "1000");
        foreach (var (key, value) in settings)
        {
            builder.UseSetting(key, value);
        }

        builder.ConfigureTestServices(services =>
        {
            services.ConfigureAll<JwtBearerOptions>(options => options.Configuration = TestIssuerConfiguration());
            extra?.Invoke(services);
        });
    }

    private OpenIdConnectConfiguration TestIssuerConfiguration()
    {
        var configuration = new OpenIdConnectConfiguration { Issuer = Issuer };
        configuration.SigningKeys.Add(Key);
        return configuration;
    }
}

/// <summary>Raw JSON-RPC bodies (2025-11-25 shape) for HTTP-level tests.</summary>
internal static class McpMessages
{
    public static string Initialize(int id = 1) => System.Text.Json.JsonSerializer.Serialize(new
    {
        jsonrpc = "2.0",
        id,
        method = "initialize",
        @params = new { protocolVersion = McpApiHost.LegacyProtocol, capabilities = new { }, clientInfo = new { name = "raw", version = "1" } },
    });

    public static string ListTools(int id = 2) => System.Text.Json.JsonSerializer.Serialize(new { jsonrpc = "2.0", id, method = "tools/list", @params = new { } });

    public static string Call(string tool, string arguments = "{}", int id = 3) => System.Text.Json.JsonSerializer.Serialize(new
    {
        jsonrpc = "2.0",
        id,
        method = "tools/call",
        @params = new { name = tool, arguments = System.Text.Json.JsonDocument.Parse(arguments).RootElement },
    });
}
