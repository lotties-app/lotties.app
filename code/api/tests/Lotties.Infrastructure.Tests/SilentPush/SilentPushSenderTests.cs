using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lotties.Application.SilentPush;
using Lotties.Domain.SilentPush;
using Lotties.Infrastructure.Push;
using Lotties.Infrastructure.SilentPush;
using Lotties.Infrastructure.Tests.Push;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Infrastructure.Tests.SilentPush;

/// <summary>The APNs and FCM senders against fake HTTP (docs/design/37b-widget-silent-push.md sections 3 and 4.5).</summary>
public sealed class SilentPushSenderTests : IDisposable
{
    private readonly SilentPushTestKit _kit = SilentPushTestKit.Create();

    public void Dispose() => _kit.Dispose();

    [Fact]
    public async Task Apns_SendsAContentFreeBackgroundPushOverHttp2()
    {
        var handler = RecordingHandler.Answering(HttpStatusCode.OK);

        var outcome = await _kit.Apns(handler).SendAsync(SilentPushTestKit.ApnsTarget());

        var sent = Assert.Single(handler.Requests);
        Assert.Equal(SilentPushOutcome.Sent, outcome);
        Assert.Equal(HttpMethod.Post, sent.Request.Method);
        Assert.Equal($"https://api.push.apple.com/3/device/{SilentPushTestKit.ApnsToken}", sent.Request.RequestUri!.AbsoluteUri);
        Assert.Equal((HttpVersion.Version20, HttpVersionPolicy.RequestVersionExact), (sent.Request.Version, sent.Request.VersionPolicy));
        Assert.Equal("background", Header(sent, "apns-push-type"));
        Assert.Equal("5", Header(sent, "apns-priority"));
        Assert.Equal("app.lotties.app", Header(sent, "apns-topic"));
        Assert.Equal((_kit.Clock.GetUtcNow() + TimeSpan.FromHours(1)).ToUnixTimeSeconds().ToString(), Header(sent, "apns-expiration"));
        Assert.Equal("""{"aps":{"content-available":1},"lotties":{"v":1,"t":"sync"}}""", Encoding.UTF8.GetString(sent.Body));
    }

    [Fact]
    public async Task Apns_SandboxDevice_GoesToTheSandboxHost()
    {
        var handler = RecordingHandler.Answering(HttpStatusCode.OK);

        await _kit.Apns(handler).SendAsync(SilentPushTestKit.ApnsTarget(ApnsEnvironment.Sandbox));

        Assert.Equal("api.sandbox.push.apple.com", Assert.Single(handler.Requests).Request.RequestUri!.Host);
    }

    [Fact]
    public async Task Apns_ProviderToken_IsAnEs256JwtOfTheKeyAndTeamVerifiedWithThePublicKey()
    {
        var handler = RecordingHandler.Answering(HttpStatusCode.OK);

        await _kit.Apns(handler).SendAsync(SilentPushTestKit.ApnsTarget());

        var authorization = Assert.Single(handler.Requests).Request.Headers.Authorization!;
        var (header, claims, signingInput, signature) = Split(authorization.Parameter!);
        Assert.Equal("bearer", authorization.Scheme);
        Assert.Equal(("ES256", "ABC123DEFG"), (header.GetProperty("alg").GetString(), header.GetProperty("kid").GetString()));
        Assert.Equal("TEAM456789", claims.GetProperty("iss").GetString());
        Assert.Equal(_kit.Clock.GetUtcNow().ToUnixTimeSeconds(), claims.GetProperty("iat").GetInt64());
        Assert.True(_kit.ApnsKey.VerifyData(signingInput, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }

    [Fact]
    public async Task Apns_ProviderToken_IsReusedForThirtyMinutesThenSignedAgain()
    {
        var handler = RecordingHandler.Answering(HttpStatusCode.OK);
        var sender = _kit.Apns(handler);

        await sender.SendAsync(SilentPushTestKit.ApnsTarget());
        _kit.Clock.Advance(TimeSpan.FromMinutes(29));
        await sender.SendAsync(SilentPushTestKit.ApnsTarget());
        _kit.Clock.Advance(TimeSpan.FromMinutes(2));
        await sender.SendAsync(SilentPushTestKit.ApnsTarget());

        var tokens = handler.Requests.Select(request => request.Request.Headers.Authorization!.Parameter).ToArray();
        Assert.Equal(tokens[0], tokens[1]);
        Assert.NotEqual(tokens[1], tokens[2]);
    }

    [Theory]
    [InlineData(HttpStatusCode.OK, null, SilentPushOutcome.Sent)]
    [InlineData(HttpStatusCode.Gone, "Unregistered", SilentPushOutcome.Gone)]
    [InlineData(HttpStatusCode.BadRequest, "BadDeviceToken", SilentPushOutcome.Invalid)]
    [InlineData(HttpStatusCode.BadRequest, "DeviceTokenNotForTopic", SilentPushOutcome.Invalid)]
    [InlineData(HttpStatusCode.BadRequest, "BadTopic", SilentPushOutcome.ConfigurationError)]
    [InlineData(HttpStatusCode.Forbidden, "InvalidProviderToken", SilentPushOutcome.ConfigurationError)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge, "PayloadTooLarge", SilentPushOutcome.ConfigurationError)]
    [InlineData(HttpStatusCode.TooManyRequests, "TooManyRequests", SilentPushOutcome.Retryable)]
    [InlineData(HttpStatusCode.ServiceUnavailable, "ServiceUnavailable", SilentPushOutcome.Retryable)]
    [InlineData(HttpStatusCode.Conflict, null, SilentPushOutcome.Failed)]
    public async Task Apns_MapsEachAnswer(HttpStatusCode status, string? reason, SilentPushOutcome expected)
    {
        var handler = new RecordingHandler(_ => reason is null ? new HttpResponseMessage(status) : SilentPushTestKit.Json(status, $$"""{"reason":"{{reason}}"}"""));

        Assert.Equal(expected, await _kit.Apns(handler).SendAsync(SilentPushTestKit.ApnsTarget()));
    }

    [Fact]
    public async Task Apns_ExpiredProviderToken_SignsANewOneForTheNextPush()
    {
        var answers = new Queue<HttpResponseMessage>([SilentPushTestKit.Json(HttpStatusCode.Forbidden, """{"reason":"ExpiredProviderToken"}"""), new HttpResponseMessage(HttpStatusCode.OK)]);
        var handler = new RecordingHandler(_ => answers.Dequeue());
        var sender = _kit.Apns(handler);

        await sender.SendAsync(SilentPushTestKit.ApnsTarget());
        _kit.Clock.Advance(TimeSpan.FromSeconds(1));
        await sender.SendAsync(SilentPushTestKit.ApnsTarget());

        var tokens = handler.Requests.Select(request => request.Request.Headers.Authorization!.Parameter).ToArray();
        Assert.NotEqual(tokens[0], tokens[1]);
    }

    [Fact]
    public async Task Apns_NetworkFailure_IsRetryableAndLogsNoToken()
    {
        var handler = RecordingHandler.Throwing(new HttpRequestException("connection refused"));

        var outcome = await _kit.Apns(handler).SendAsync(SilentPushTestKit.ApnsTarget());

        Assert.Equal(SilentPushOutcome.Retryable, outcome);
        Assert.DoesNotContain(_kit.Logs.Messages, message => message.Contains(SilentPushTestKit.ApnsToken, StringComparison.Ordinal));
    }

    [Fact]
    public async Task Apns_ConfigurationError_IsLoggedOnceAnHourWithoutSecrets()
    {
        var handler = new RecordingHandler(_ => SilentPushTestKit.Json(HttpStatusCode.Forbidden, """{"reason":"InvalidProviderToken"}"""));
        var sender = _kit.Apns(handler);

        await sender.SendAsync(SilentPushTestKit.ApnsTarget());
        await sender.SendAsync(SilentPushTestKit.ApnsTarget());

        Assert.Single(_kit.Logs.Messages, message => message.StartsWith("Error", StringComparison.Ordinal));
        Assert.DoesNotContain(_kit.Logs.Messages, message => message.Contains(SilentPushTestKit.ApnsToken, StringComparison.Ordinal) || message.Contains("PRIVATE KEY", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(SilentPushOptions.NormalPriority, "NORMAL")]
    [InlineData(SilentPushOptions.HighPriority, "HIGH")]
    public async Task Fcm_SendsADataMessageWithNoNotification(string priority, string expectedPriority)
    {
        var handler = RecordingHandler.Answering(HttpStatusCode.OK);

        var outcome = await _kit.Fcm(handler, options: _kit.Options(priority: priority)).SendAsync(SilentPushTestKit.FcmTarget());

        var sent = Assert.Single(handler.Requests);
        using var body = JsonDocument.Parse(sent.Body);
        var message = body.RootElement.GetProperty("message");
        Assert.Equal(SilentPushOutcome.Sent, outcome);
        Assert.Equal("https://fcm.googleapis.com/v1/projects/lotties-test/messages:send", sent.Request.RequestUri!.AbsoluteUri);
        Assert.Equal(("Bearer", "ya29.test-access-token"), (sent.Request.Headers.Authorization!.Scheme, sent.Request.Headers.Authorization.Parameter));
        Assert.Equal(SilentPushTestKit.FcmToken, message.GetProperty("token").GetString());
        Assert.False(message.TryGetProperty("notification", out _));
        Assert.Equal("""{"lotties":"sync","v":"1"}""", message.GetProperty("data").GetRawText());
        Assert.Equal(expectedPriority, message.GetProperty("android").GetProperty("priority").GetString());
        Assert.Equal(("3600s", "lotties-sync"), (message.GetProperty("android").GetProperty("ttl").GetString(), message.GetProperty("android").GetProperty("collapse_key").GetString()));
    }

    [Fact]
    public async Task Fcm_AccessToken_IsAnRs256AssertionOfTheServiceAccountVerifiedWithThePublicKey()
    {
        var oauth = SilentPushTestKit.TokenEndpoint();

        await _kit.Fcm(RecordingHandler.Answering(HttpStatusCode.OK), oauth).SendAsync(SilentPushTestKit.FcmTarget());

        var exchange = Assert.Single(oauth.Requests);
        var form = Encoding.ASCII.GetString(exchange.Body).Split('&').Select(pair => pair.Split('=')).ToDictionary(pair => pair[0], pair => Uri.UnescapeDataString(pair[1]));
        var (header, claims, signingInput, signature) = Split(form["assertion"]);
        Assert.Equal("https://oauth2.googleapis.com/token", exchange.Request.RequestUri!.AbsoluteUri);
        Assert.Equal("urn:ietf:params:oauth:grant-type:jwt-bearer", form["grant_type"]);
        Assert.Equal("RS256", header.GetProperty("alg").GetString());
        Assert.Equal(SilentPushTestKit.ServiceAccountEmail, claims.GetProperty("iss").GetString());
        Assert.Equal("https://www.googleapis.com/auth/firebase.messaging", claims.GetProperty("scope").GetString());
        Assert.Equal("https://oauth2.googleapis.com/token", claims.GetProperty("aud").GetString());
        Assert.Equal(3600, claims.GetProperty("exp").GetInt64() - claims.GetProperty("iat").GetInt64());
        Assert.True(_kit.GoogleKey.VerifyData(signingInput, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
    }

    [Fact]
    public async Task Fcm_AccessToken_IsKeptUntilFiveMinutesBeforeItExpires()
    {
        var oauth = SilentPushTestKit.TokenEndpoint();
        var sender = _kit.Fcm(RecordingHandler.Answering(HttpStatusCode.OK), oauth);

        await sender.SendAsync(SilentPushTestKit.FcmTarget());
        _kit.Clock.Advance(TimeSpan.FromMinutes(54));
        await sender.SendAsync(SilentPushTestKit.FcmTarget());
        _kit.Clock.Advance(TimeSpan.FromMinutes(2));
        await sender.SendAsync(SilentPushTestKit.FcmTarget());

        Assert.Equal(2, oauth.Requests.Count);
    }

    [Fact]
    public async Task Fcm_Unauthorized_GetsANewAccessTokenOnceAndRepeats()
    {
        var answers = new Queue<HttpResponseMessage>([new HttpResponseMessage(HttpStatusCode.Unauthorized), new HttpResponseMessage(HttpStatusCode.OK)]);
        var oauth = SilentPushTestKit.TokenEndpoint();

        var outcome = await _kit.Fcm(new RecordingHandler(_ => answers.Dequeue()), oauth).SendAsync(SilentPushTestKit.FcmTarget());

        Assert.Equal(SilentPushOutcome.Sent, outcome);
        Assert.Equal(2, oauth.Requests.Count);
    }

    [Fact]
    public async Task Fcm_UnauthorizedTwice_IsAConfigurationError()
    {
        var handler = RecordingHandler.Answering(HttpStatusCode.Unauthorized);

        var outcome = await _kit.Fcm(handler).SendAsync(SilentPushTestKit.FcmTarget());

        Assert.Equal(SilentPushOutcome.ConfigurationError, outcome);
        Assert.Equal(2, handler.Requests.Count);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest, SilentPushOutcome.ConfigurationError)]
    [InlineData(HttpStatusCode.ServiceUnavailable, SilentPushOutcome.Retryable)]
    public async Task Fcm_RefusedTokenExchange_SendsNothing(HttpStatusCode exchangeStatus, SilentPushOutcome expected)
    {
        var handler = RecordingHandler.Answering(HttpStatusCode.OK);

        var outcome = await _kit.Fcm(handler, RecordingHandler.Answering(exchangeStatus)).SendAsync(SilentPushTestKit.FcmTarget());

        Assert.Equal(expected, outcome);
        Assert.Empty(handler.Requests);
    }

    [Theory]
    [InlineData(404, "UNREGISTERED", "Requested entity was not found.", SilentPushOutcome.Gone)]
    [InlineData(400, "INVALID_ARGUMENT", "The registration token is not a valid FCM registration token", SilentPushOutcome.Invalid)]
    [InlineData(400, "INVALID_ARGUMENT", "Invalid value at 'message.android.ttl'", SilentPushOutcome.ConfigurationError)]
    [InlineData(403, "SENDER_ID_MISMATCH", "SenderId mismatch", SilentPushOutcome.Invalid)]
    [InlineData(403, null, "Permission denied", SilentPushOutcome.ConfigurationError)]
    [InlineData(404, null, "Project not found", SilentPushOutcome.ConfigurationError)]
    [InlineData(429, "QUOTA_EXCEEDED", "Quota exceeded", SilentPushOutcome.Retryable)]
    [InlineData(503, "UNAVAILABLE", "Unavailable", SilentPushOutcome.Retryable)]
    public async Task Fcm_MapsEachAnswer(int status, string? errorCode, string message, SilentPushOutcome expected)
    {
        var details = errorCode is null ? "[]" : $$"""[{"@type":"type.googleapis.com/google.firebase.fcm.v1.FcmError","errorCode":"{{errorCode}}"}]""";
        var body = $$"""{"error":{"code":{{status}},"message":"{{message}}","status":"X","details":""" + details + "}}";
        var handler = new RecordingHandler(_ => SilentPushTestKit.Json((HttpStatusCode)status, body));

        Assert.Equal(expected, await _kit.Fcm(handler).SendAsync(SilentPushTestKit.FcmTarget()));
    }

    [Fact]
    public async Task Fcm_LogsNoTokenAndNoKey()
    {
        var handler = new RecordingHandler(_ => SilentPushTestKit.Json(HttpStatusCode.Forbidden, """{"error":{"code":403,"message":"denied"}}"""));

        await _kit.Fcm(handler).SendAsync(SilentPushTestKit.FcmTarget());

        Assert.NotEmpty(_kit.Logs.Messages);
        Assert.DoesNotContain(_kit.Logs.Messages, message =>
            message.Contains(SilentPushTestKit.FcmToken, StringComparison.Ordinal)
            || message.Contains("ya29.", StringComparison.Ordinal)
            || message.Contains("PRIVATE KEY", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Dispatching_PicksTheConfiguredSenderOfTheChannel()
    {
        var handler = RecordingHandler.Answering(HttpStatusCode.OK);
        var options = _kit.Options(apns: true, fcm: false);
        var channels = _kit.Channels(options);
        var apns = new ApnsSilentPushSender(new HttpClient(handler), channels, Microsoft.Extensions.Options.Options.Create(options), _kit.Clock, NullLogger<ApnsSilentPushSender>.Instance);
        var fcm = new FcmSilentPushSender(new HttpClient(handler), channels, Microsoft.Extensions.Options.Options.Create(options), NullLogger<FcmSilentPushSender>.Instance);
        var sender = new DispatchingSilentPushSender([apns, fcm], NullLogger<DispatchingSilentPushSender>.Instance);

        var toApns = await sender.SendAsync(SilentPushTestKit.ApnsTarget());
        var toFcm = await sender.SendAsync(SilentPushTestKit.FcmTarget());

        Assert.Equal((SilentPushOutcome.Sent, SilentPushOutcome.NotConfigured), (toApns, toFcm));
        Assert.Single(handler.Requests);
    }

    [Fact]
    public void Target_ToString_HidesTheToken()
    {
        Assert.DoesNotContain(SilentPushTestKit.ApnsToken, SilentPushTestKit.ApnsTarget().ToString(), StringComparison.Ordinal);
    }

    private static string? Header(RecordedRequest sent, string name) =>
        sent.Request.Headers.TryGetValues(name, out var values) ? string.Join(",", values) : null;

    private static (JsonElement Header, JsonElement Claims, byte[] SigningInput, byte[] Signature) Split(string jwt)
    {
        var parts = jwt.Split('.');
        Assert.Equal(3, parts.Length);
        var header = JsonDocument.Parse(Base64Url.TryDecode(parts[0])!).RootElement;
        var claims = JsonDocument.Parse(Base64Url.TryDecode(parts[1])!).RootElement;
        return (header, claims, Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), Base64Url.TryDecode(parts[2])!);
    }
}
