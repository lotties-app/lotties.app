using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using static Lotties.Api.Tests.Assistants.McpProtocolTests;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The MCP server at the HTTP level (MCP Authorization and Streamable HTTP, revision 2026-07-28): the 401 challenge with
/// <c>resource_metadata</c>, token validation (expired, audience, issuer, signature, <c>sub</c>, query string), the 403 scope
/// challenge, the protected resource metadata, origin validation, size and rate limits, and the server off by default.
/// </summary>
public sealed class McpHttpTests(McpApiHost host) : IClassFixture<McpApiHost>
{
    private const string MetadataUrl = "http://localhost/.well-known/oauth-protected-resource/api/v1/mcp";

    [Fact]
    public async Task NoToken_Is401WithTheResourceMetadataAndTheReadScope()
    {
        var response = await host.PostAsync(token: null, McpMessages.Initialize());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal($"Bearer resource_metadata=\"{MetadataUrl}\", scope=\"lotties.read\"", response.Headers.WwwAuthenticate.ToString());
    }

    [Theory]
    [InlineData("expired")]
    [InlineData("api-audience")]
    [InlineData("other-issuer")]
    [InlineData("other-key")]
    [InlineData("no-subject")]
    [InlineData("not-a-jwt")]
    public async Task InvalidToken_Is401WithInvalidToken(string flaw)
    {
        var response = await host.PostAsync(TokenWith(flaw), McpMessages.Initialize());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.StartsWith("Bearer error=\"invalid_token\"", response.Headers.WwwAuthenticate.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task ValidToken_OfThisHost_PassesWhereTheInvalidOnesFail()
    {
        var baby = await host.Factory.SeedBabyAsync();

        var response = await host.PostAsync(host.TokenFor(baby.OwnerSubject), McpMessages.Initialize());

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Mcp-Session-Id"));
    }

    [Fact]
    public async Task WebAppToken_TheApiAudience_IsRefused()
    {
        var baby = await host.Factory.SeedBabyAsync();

        var response = await host.PostAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite, audience: McpApiHost.ApiAudience), McpMessages.ListTools());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task TokenInTheQueryString_IsNotRead()
    {
        var baby = await host.Factory.SeedBabyAsync();
        var token = host.TokenFor(baby.OwnerSubject);

        var response = await host.HttpFor(token: null).PostAsync($"{McpApiHost.Path}?access_token={token}", new StringContent(McpMessages.Initialize(), Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task TokenWithoutALottiesScope_Is403InsufficientScopeAskingForRead()
    {
        var baby = await host.Factory.SeedBabyAsync();

        var response = await host.PostAsync(host.TokenFor(baby.OwnerSubject, scope: "openid profile"), McpMessages.Initialize());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var challenge = response.Headers.WwwAuthenticate.ToString();
        Assert.StartsWith("Bearer error=\"insufficient_scope\", scope=\"lotties.read\"", challenge, StringComparison.Ordinal);
        Assert.Contains($"resource_metadata=\"{MetadataUrl}\"", challenge, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("log_diaper", """{"kind":"wet"}""", McpScopes.Read, McpScopes.Write)]
    [InlineData("log_bottle", """{"amountMl":100}""", McpScopes.Read, McpScopes.Write)]
    [InlineData("request_delete_last_entry", "{}", McpScopes.Read, McpScopes.Write)]
    [InlineData("get_cry_reasons", "{}", McpScopes.Write, McpScopes.Read)]
    [InlineData("get_last_feed", "{}", McpScopes.Write, McpScopes.Read)]
    public async Task CallingAToolOutsideTheTokensScopes_Is403NamingTheMissingScope_AndRunsNothing(string tool, string arguments, string granted, string missing)
    {
        var baby = await host.Factory.SeedBabyAsync();

        var response = await host.PostAsync(host.TokenFor(baby.OwnerSubject, granted), McpMessages.Call(tool, arguments));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.StartsWith($"Bearer error=\"insufficient_scope\", scope=\"{missing}\"", response.Headers.WwwAuthenticate.ToString(), StringComparison.Ordinal);
        Assert.Empty(await host.Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task SpeechLocaleHeader_AddsTheSentenceTheAlexaSkillWouldSay_AndWithoutItNothingExtra()
    {
        var baby = await host.Factory.SeedBabyAsync();
        var token = host.TokenFor(baby.OwnerSubject);

        var plain = await (await host.PostAsync(token, McpMessages.Call("get_diapers_today"))).Content.ReadAsStringAsync();
        var spoken = await (await host.PostAsync(token, McpMessages.Call("get_diapers_today"), (McpToolRunner.SpeechLocaleHeader, "pt-BR"))).Content.ReadAsStringAsync();

        Assert.DoesNotContain("speech", plain, StringComparison.Ordinal);
        Assert.Contains("speech", spoken, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ReadToken_ToolsCallOfAReadTool_Passes()
    {
        var baby = await host.Factory.SeedBabyAsync();

        var response = await host.PostAsync(host.TokenFor(baby.OwnerSubject), McpMessages.Call("get_diapers_today"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("diapers_today", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task BodyOverTheLimit_Is413()
    {
        var baby = await host.Factory.SeedBabyAsync();
        var padding = new string('a', 70 * 1024);

        var response = await host.PostAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite), McpMessages.Call("log_diaper", $$"""{"kind":"wet","pad":"{{padding}}"}"""));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Empty(await host.Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task ForeignOrigin_Is403_NoOriginPasses()
    {
        var baby = await host.Factory.SeedBabyAsync();
        var token = host.TokenFor(baby.OwnerSubject);

        var foreign = await host.PostAsync(token, McpMessages.Initialize(), ("Origin", "https://evil.example"));
        var serverSide = await host.PostAsync(token, McpMessages.Initialize());

        Assert.Equal((HttpStatusCode.Forbidden, HttpStatusCode.OK), (foreign.StatusCode, serverSide.StatusCode));
    }

    [Fact]
    public async Task AllowedOrigin_Passes()
    {
        using var allowing = McpApiHost.With(("Mcp:AllowedOrigins", "https://inspector.example, https://other.example"));
        var baby = await allowing.Factory.SeedBabyAsync();

        var response = await allowing.PostAsync(allowing.TokenFor(baby.OwnerSubject), McpMessages.Initialize(), ("Origin", "https://inspector.example"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("https://inspector.example", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Theory]
    [InlineData("/.well-known/oauth-protected-resource/api/v1/mcp")]
    [InlineData("/.well-known/oauth-protected-resource")]
    public async Task ProtectedResourceMetadata_IsPublicAndNamesTheIssuerAndScopes(string path)
    {
        var response = await host.HttpFor(token: null).GetAsync(path);
        var metadata = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("http://localhost/api/v1/mcp", metadata.GetProperty("resource").GetString());
        Assert.Equal([McpApiHost.Issuer], metadata.GetProperty("authorization_servers").EnumerateArray().Select(server => server.GetString()));
        Assert.Equal([McpScopes.Read, McpScopes.Write], metadata.GetProperty("scopes_supported").EnumerateArray().Select(scope => scope.GetString()));
        Assert.Equal(["header"], metadata.GetProperty("bearer_methods_supported").EnumerateArray().Select(method => method.GetString()));
    }

    [Fact]
    public async Task ConfiguredResourceUrl_IsTheMetadataResourceAndTheChallengeTarget()
    {
        using var configured = McpApiHost.With(("Mcp:ResourceUrl", "https://lotties.example/api/v1/mcp"));

        var metadata = await configured.HttpFor(token: null).GetFromJsonAsync<JsonElement>("/.well-known/oauth-protected-resource/api/v1/mcp");
        var challenge = await configured.PostAsync(token: null, McpMessages.Initialize());

        Assert.Equal("https://lotties.example/api/v1/mcp", metadata.GetProperty("resource").GetString());
        Assert.Contains("resource_metadata=\"https://lotties.example/.well-known/oauth-protected-resource/api/v1/mcp\"", challenge.Headers.WwwAuthenticate.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task OverTheUsersAssistantLimit_IsARateLimitedToolError()
    {
        using var limited = McpApiHost.With(("RequestLimits:AssistantPermitsPerMinute", "2"));
        var baby = await limited.Factory.SeedBabyAsync();
        await using var client = await limited.ClientAsync(limited.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        await client.CallToolAsync("get_last_feed", Args());
        await client.CallToolAsync("get_last_feed", Args());
        var third = await client.CallToolAsync("log_diaper", Args(("kind", "wet")));

        Assert.Equal((true, "rate_limited"), (third.IsError, Code(third)));
        Assert.Empty(await limited.Factory.EventsAsync(baby.BabyId));
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("DELETE")]
    public async Task GetAndDelete_Are405AllowingPost_NotASignInChallenge(string method)
    {
        var baby = await host.Factory.SeedBabyAsync();
        var request = new HttpRequestMessage(new HttpMethod(method), McpApiHost.Path);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", host.TokenFor(baby.OwnerSubject));

        var response = await host.HttpFor(token: null).SendAsync(request);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        Assert.Equal(["POST"], response.Content.Headers.Allow);
    }

    [Theory]
    [InlineData("POST", "/api/v1/mcp")]
    [InlineData("GET", "/api/v1/mcp")]
    [InlineData("DELETE", "/api/v1/mcp")]
    [InlineData("GET", "/.well-known/oauth-protected-resource")]
    [InlineData("GET", "/.well-known/oauth-protected-resource/api/v1/mcp")]
    public async Task DisabledByDefault_EveryRouteIs404EvenWithAValidToken(string method, string path)
    {
        using var factory = new ApiFactory();
        var request = new HttpRequestMessage(new HttpMethod(method), path);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", host.TokenFor(TestUsers.NewSubject(), McpApiHost.ReadWrite));
        if (method == "POST")
        {
            request.Content = new StringContent(McpMessages.Initialize(), Encoding.UTF8, "application/json");
        }

        var response = await factory.CreateClient().SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task AssistantSettings_McpEnabled_GiveTheUrlToPasteEqualToTheMetadataResource()
    {
        var settings = await ClinicalTestData.ClientFor(host.Host, TestUsers.NewSubject()).GetFromJsonAsync<JsonElement>("/api/v1/me/assistant-settings");
        var metadata = await host.HttpFor(token: null).GetFromJsonAsync<JsonElement>("/.well-known/oauth-protected-resource/api/v1/mcp");

        Assert.True(settings.GetProperty("mcpEnabled").GetBoolean());
        Assert.Equal(metadata.GetProperty("resource").GetString(), settings.GetProperty("mcpUrl").GetString());
        Assert.Equal("http://localhost/api/v1/mcp", settings.GetProperty("mcpUrl").GetString());
    }

    [Fact]
    public void McpScheme_IsTheApisValidationWithOnlyTheAudienceChanged()
    {
        var schemes = host.Host.Services.GetRequiredService<IOptionsMonitor<Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerOptions>>();
        var api = schemes.Get(Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerDefaults.AuthenticationScheme);
        var mcp = schemes.Get(McpTokens.SchemeName);

        Assert.Equal((McpApiHost.ApiAudience, McpApiHost.Audience), (api.Audience, mcp.Audience));
        Assert.Equal((api.Authority, api.RequireHttpsMetadata, api.MapInboundClaims), (mcp.Authority, mcp.RequireHttpsMetadata, mcp.MapInboundClaims));
        Assert.Equal((true, true, true), (mcp.TokenValidationParameters.ValidateIssuer, mcp.TokenValidationParameters.ValidateLifetime, mcp.TokenValidationParameters.ValidateAudience));
        Assert.NotNull(mcp.Events.OnTokenValidated);
    }

    [Fact]
    public void Options_DefaultsAreOffWithTheMcpAudience() =>
        Assert.Equal((false, "lotties-mcp", 64 * 1024), (new McpOptions().Enabled, new McpOptions().Audience, new McpOptions().MaxRequestBodyBytes));

    [Theory]
    [InlineData(true, "https://id.test/realms/x", "lotties-api", "lotties-mcp", null, true)]
    [InlineData(false, null, null, "lotties-mcp", null, true)]
    [InlineData(true, "https://id.test/realms/x", "lotties-api", "lotties-api", null, false)]
    [InlineData(true, "https://id.test/realms/x", "lotties-api", " ", null, false)]
    [InlineData(true, null, null, "lotties-mcp", null, false)]
    [InlineData(true, "https://id.test/realms/x", "lotties-api", "lotties-mcp", "lotties.example/mcp", false)]
    [InlineData(true, "https://id.test/realms/x", "lotties-api", "lotties-mcp", "https://lotties.example/mcp#x", false)]
    public void Options_Validation(bool enabled, string? authority, string? apiAudience, string audience, string? resourceUrl, bool valid)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection([KeyValuePair.Create("Auth:Authority", authority), KeyValuePair.Create("Auth:Audience", apiAudience)])
            .Build();
        var validator = new McpOptionsValidator(configuration);

        var result = validator.Validate(null, new McpOptions { Enabled = enabled, Audience = audience, ResourceUrl = resourceUrl });

        Assert.Equal(valid, result.Succeeded);
    }

    [Fact]
    public async Task ToolCalls_LogOnlyTheToolNameCodeAndCorrelation_NeverArgumentsOrTokens()
    {
        var logs = new CapturingLoggerProvider();
        using var capturing = McpApiHost.WithServices(services => services.AddSingleton<Microsoft.Extensions.Logging.ILoggerProvider>(logs));
        var baby = await capturing.Factory.SeedBabyAsync();
        var token = capturing.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite);

        var response = await capturing.PostAsync(token, McpMessages.Call("log_bottle", """{"amountMl":137,"idempotencyKey":"secret-key-123456"}"""));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var lines = logs.Messages;
        Assert.Contains(lines, line => line.StartsWith("MCP log_bottle: bottle_logged (correlation ", StringComparison.Ordinal));
        Assert.DoesNotContain(lines, line => line.Contains("secret-key-123456", StringComparison.Ordinal) || System.Text.RegularExpressions.Regex.IsMatch(line, @"(?<![\w.-])137(?![\w.-])") || line.Contains(token, StringComparison.Ordinal));
    }

    private string TokenWith(string flaw)
    {
        var subject = TestUsers.NewSubject();
        using var stranger = System.Security.Cryptography.RSA.Create(2048);
        return flaw switch
        {
            "expired" => host.TokenFor(subject, expires: DateTimeOffset.UtcNow.AddMinutes(-10)),
            "api-audience" => host.TokenFor(subject, audience: McpApiHost.ApiAudience),
            "other-issuer" => host.TokenFor(subject, issuer: "https://evil.test/realms/lotties.app"),
            "other-key" => host.TokenFor(subject, key: new RsaSecurityKey(stranger.ExportParameters(includePrivateParameters: true)) { KeyId = "test-key" }),
            "no-subject" => host.TokenFor(string.Empty),
            _ => "not-a-jwt",
        };
    }
}

/// <summary>Keeps every formatted log message of the host (all categories and levels the filters let through).</summary>
internal sealed class CapturingLoggerProvider : Microsoft.Extensions.Logging.ILoggerProvider
{
    private readonly System.Collections.Concurrent.ConcurrentQueue<string> _messages = new();

    public IReadOnlyList<string> Messages => _messages.ToArray();

    public Microsoft.Extensions.Logging.ILogger CreateLogger(string categoryName) => new Logger(_messages);

    public void Dispose()
    {
    }

    private sealed class Logger(System.Collections.Concurrent.ConcurrentQueue<string> messages) : Microsoft.Extensions.Logging.ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;

        public void Log<TState>(Microsoft.Extensions.Logging.LogLevel logLevel, Microsoft.Extensions.Logging.EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            messages.Enqueue(formatter(state, exception));
    }
}
