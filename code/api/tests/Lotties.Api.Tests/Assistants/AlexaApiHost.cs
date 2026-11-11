using System.Net.Http.Headers;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Tests.Support;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The test API with Alexa enabled for <see cref="SkillId"/>, and OIDC configured for a test issuer whose signing key lives
/// here (the discovery document is replaced by a static configuration, so the real JWT bearer validation runs: issuer,
/// audience, lifetime, signature, <c>sub</c>). Amazon's signature cannot be produced for real requests, so the verifier is
/// a pass-through double by default; <see cref="WithRealVerifier"/> keeps the real verifier and serves it a test chain.
/// The skill checks the request timestamp against <see cref="AlexaRequests.SentAt"/>, the instant every test body is stamped
/// with, not against the wall clock: a loaded CI runner can hold a request for minutes between building the body and the
/// check, which made fresh requests "stale" (the tolerance itself is tested from that fixed instant, AlexaEndpointTests).
/// </summary>
public sealed class AlexaApiHost : IDisposable
{
    public const string SkillId = "amzn1.ask.skill.11111111-2222-3333-4444-555555555555";
    public const string Issuer = "https://id.lotties.test/realms/lotties.app";
    public const string Audience = "lotties-api";

    private readonly RSA _signingKey = RSA.Create(2048);

    public AlexaApiHost()
        : this(realVerifier: null, [])
    {
    }

    private AlexaApiHost(AlexaTestCertificates? realVerifier, IReadOnlyList<(string Key, string Value)> settings)
    {
        Factory = new ApiFactory();
        Host = Factory.WithWebHostBuilder(builder => Configure(builder, realVerifier, settings));
    }

    internal ApiFactory Factory { get; }

    internal WebApplicationFactory<Program> Host { get; }

    internal SecurityKey Key => new RsaSecurityKey(_signingKey) { KeyId = "test-key" };

    /// <summary>A host that keeps the real verifier, trusting <paramref name="certificates"/>' root and serving its chain.</summary>
    internal static AlexaApiHost WithRealVerifier(AlexaTestCertificates certificates) => new(certificates, []);

    /// <summary>A host with extra settings (e.g. a low limit); dispose it after the test.</summary>
    internal static AlexaApiHost With(params (string Key, string Value)[] settings) => new(null, settings);

    public void Dispose()
    {
        Host.Dispose();
        Factory.Dispose();
        _signingKey.Dispose();
    }

    /// <summary>An access token for <paramref name="subject"/> as Keycloak would issue it to the Alexa client.</summary>
    internal string TokenFor(string subject, string audience = Audience, DateTimeOffset? expires = null, string issuer = Issuer, SecurityKey? key = null)
    {
        var until = expires ?? DateTimeOffset.UtcNow.AddMinutes(30);
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = audience,
            Subject = new ClaimsIdentity([new Claim("sub", subject)]),
            IssuedAt = until.UtcDateTime.AddHours(-1),
            NotBefore = until.UtcDateTime.AddHours(-1),
            Expires = until.UtcDateTime,
            SigningCredentials = new SigningCredentials(key ?? Key, SecurityAlgorithms.RsaSha256),
        });
    }

    internal Task<HttpResponseMessage> PostAsync(string body, params (string Name, string Value)[] headers)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/alexa") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        foreach (var (name, value) in headers)
        {
            request.Headers.TryAddWithoutValidation(name, value);
        }

        return Host.CreateClient().SendAsync(request);
    }

    internal static async Task<JsonElement> ReadAsync(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
    }

    /// <summary>The spoken text of a response (the SSML without <c>&lt;speak&gt;</c>, XML entities decoded).</summary>
    internal static string Speech(JsonElement response)
    {
        var ssml = response.GetProperty("response").GetProperty("outputSpeech").GetProperty("ssml").GetString()!;
        Assert.StartsWith("<speak>", ssml, StringComparison.Ordinal);
        return System.Net.WebUtility.HtmlDecode(ssml["<speak>".Length..^"</speak>".Length]);
    }

    private void Configure(IWebHostBuilder builder, AlexaTestCertificates? realVerifier, IReadOnlyList<(string Key, string Value)> settings)
    {
        builder.UseSetting("Alexa:Enabled", "true");
        builder.UseSetting("Alexa:SkillIds", SkillId);
        builder.UseSetting("Auth:Authority", Issuer);
        builder.UseSetting("Auth:Audience", Audience);
        builder.UseSetting("RequestLimits:AssistantPermitsPerMinute", "1000");
        foreach (var (key, value) in settings)
        {
            builder.UseSetting(key, value);
        }

        builder.ConfigureTestServices(services =>
        {
            services.ConfigureAll<JwtBearerOptions>(options => options.Configuration = TestIssuerConfiguration());
            ReplaceVerification(services, realVerifier);
            services.RemoveAll<AlexaSkill>();
            services.AddScoped(provider => ActivatorUtilities.CreateInstance<AlexaSkill>(provider, (TimeProvider)new FixedTimeProvider(AlexaRequests.SentAt)));
        });
    }

    private OpenIdConnectConfiguration TestIssuerConfiguration()
    {
        var configuration = new OpenIdConnectConfiguration { Issuer = Issuer };
        configuration.SigningKeys.Add(Key);
        return configuration;
    }

    private static void ReplaceVerification(IServiceCollection services, AlexaTestCertificates? realVerifier)
    {
        if (realVerifier is null)
        {
            services.RemoveAll<IAlexaRequestVerifier>();
            services.AddSingleton<IAlexaRequestVerifier, AcceptingVerifier>();
            return;
        }

        services.RemoveAll<IAlexaCertificateChainProvider>();
        services.AddSingleton<IAlexaCertificateChainProvider>(new FixedChainProvider(realVerifier.Chain));
        services.RemoveAll<AlexaTrustAnchors>();
        services.AddSingleton(realVerifier.Trust);
    }

    /// <summary>Accepts every request whose two signature headers are present (Amazon's signature cannot be made in a test).</summary>
    private sealed class AcceptingVerifier : IAlexaRequestVerifier
    {
        public Task<AlexaVerification> VerifyAsync(AlexaSignedRequest request, CancellationToken cancellationToken = default) =>
            Task.FromResult(string.IsNullOrEmpty(request.CertificateChainUrl) ? AlexaVerification.MissingHeaders : AlexaVerification.Valid);
    }
}

/// <summary>Alexa request bodies (request and response JSON reference), built like the Alexa service sends them.</summary>
internal static class AlexaRequests
{
    /// <summary>When every request is sent, for the skill's timestamp check (<see cref="AlexaApiHost"/>): whole seconds, as Alexa stamps.</summary>
    public static readonly DateTimeOffset SentAt = new(2026, 1, 15, 12, 0, 0, TimeSpan.Zero);

    public static readonly (string Name, string Value)[] SignedHeaders =
    [
        ("SignatureCertChainUrl", "https://s3.amazonaws.com/echo.api/echo-api-cert-test.pem"),
        ("Signature-256", Convert.ToBase64String(new byte[256])),
    ];

    public static string Intent(string name, string? token, string locale = "en-US", object? slots = null, string? requestId = null, DateTimeOffset? timestamp = null, string skillId = AlexaApiHost.SkillId) =>
        Envelope(new { type = "IntentRequest", requestId = requestId ?? NewRequestId(), timestamp = Stamp(timestamp), locale, intent = new { name, confirmationStatus = "NONE", slots = slots ?? new { } } }, token, skillId);

    public static string Launch(string? token = null, string locale = "en-US") =>
        Envelope(new { type = "LaunchRequest", requestId = NewRequestId(), timestamp = Stamp(null), locale }, token, AlexaApiHost.SkillId);

    public static string SessionEnded(string locale = "en-US") =>
        Envelope(new { type = "SessionEndedRequest", requestId = NewRequestId(), timestamp = Stamp(null), locale, reason = "USER_INITIATED" }, null, AlexaApiHost.SkillId);

    public static object Slot(string name, string value) => new { name, value, confirmationStatus = "NONE" };

    public static object ResolvedSlot(string name, string value, string id) => new
    {
        name,
        value,
        resolutions = new
        {
            resolutionsPerAuthority = new[]
            {
                new { authority = "amzn1.er-authority.echo-sdk.test", status = new { code = "ER_SUCCESS_MATCH" }, values = new[] { new { value = new { name = value, id } } } },
            },
        },
    };

    public static string NewRequestId() => $"amzn1.echo-api.request.{Guid.NewGuid()}";

    /// <summary>A request timestamp as Alexa writes it; <see cref="SentAt"/> unless another instant is given.</summary>
    public static string Stamp(DateTimeOffset? timestamp = null) => (timestamp ?? SentAt).UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", System.Globalization.CultureInfo.InvariantCulture);

    private static string Envelope(object request, string? token, string skillId)
    {
        var user = new { userId = "amzn1.ask.account.TEST", accessToken = token };
        return JsonSerializer.Serialize(new
        {
            version = "1.0",
            session = new { @new = true, sessionId = "amzn1.echo-api.session.TEST", application = new { applicationId = skillId }, attributes = new { }, user },
            context = new { System = new { application = new { applicationId = skillId }, user, device = new { deviceId = "amzn1.ask.device.TEST" }, apiEndpoint = "https://api.amazonalexa.com" } },
            request,
        });
    }
}
