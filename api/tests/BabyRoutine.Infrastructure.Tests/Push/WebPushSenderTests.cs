using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BabyRoutine.Application.Push;
using BabyRoutine.Domain.Notifications;
using BabyRoutine.Infrastructure.Push;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Infrastructure.Tests.Push;

public sealed class WebPushSenderTests
{
    private const string Subject = "mailto:operator@example.com";
    private const string Payload = """{"v":1,"id":"6f1c2f0e-8f43-4c55-9d43-7d5b8f5a0c11","kind":"dose_due","babyId":"0b7f3f3e-0d9c-4f34-9a4e-2a43f4d4a8a1","at":"2026-10-21T21:00:00Z","lang":"pt-BR"}""";
    private static readonly VapidKeyPair Vapid = VapidKeys.Generate();
    private static readonly NotificationKey DoseKey = NotificationKey.ForDose(Guid.Parse("a2d5b1c4-5e6f-4a7b-8c9d-0e1f2a3b4c5d"), new DateTimeOffset(2026, 10, 21, 21, 0, 0, TimeSpan.Zero));
    private static readonly PushMessage DoseMessage = PushMessage.Create(Payload, DoseKey, NotificationRules.DoseTimeToLive, NotificationUrgency.High);

    [Fact]
    public async Task SendAsync_Created_PostsEncryptedPayloadWithWebPushHeaders()
    {
        using var browser = TestBrowserSubscription.Create();
        var handler = RecordingHandler.Answering(HttpStatusCode.Created);

        var result = await CreateSender(handler).SendAsync(browser.Target, DoseMessage);

        Assert.Equal(new PushSendResult(201, null, PushSendStatus.Sent), result);
        var sent = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, sent.Request.Method);
        Assert.Equal(browser.Target.Endpoint.Value, sent.Request.RequestUri!.AbsoluteUri);
        Assert.Equal("5400", Assert.Single(sent.Request.Headers.GetValues("TTL")));
        Assert.Equal("high", Assert.Single(sent.Request.Headers.GetValues("Urgency")));
        Assert.Equal(DoseMessage.Topic, Assert.Single(sent.Request.Headers.GetValues("Topic")));
        Assert.Equal("aes128gcm", Assert.Single(sent.Request.Content!.Headers.ContentEncoding));
        Assert.Equal(Payload, browser.Decrypt(sent.Body));
    }

    [Fact]
    public async Task SendAsync_Created_SignsVapidTokenForThePushServiceOrigin()
    {
        using var browser = TestBrowserSubscription.Create();
        var handler = RecordingHandler.Answering(HttpStatusCode.Created);

        await CreateSender(handler).SendAsync(browser.Target, DoseMessage);

        var authorization = Assert.Single(handler.Requests).Request.Headers.Authorization!;
        Assert.Equal("vapid", authorization.Scheme);
        var parameters = authorization.Parameter!.Split(',').Select(part => part.Trim().Split('=', 2)).ToDictionary(pair => pair[0], pair => pair[1]);
        Assert.Equal(Vapid.PublicKey, parameters["k"]);
        var claims = VerifiedClaims(parameters["t"], Vapid.PublicKey);
        Assert.Equal("https://fcm.googleapis.com", claims.GetProperty("aud").GetString());
        Assert.Equal(Subject, claims.GetProperty("sub").GetString());
    }

    [Fact]
    public async Task SendAsync_NormalUrgency_SendsNormalUrgencyAndMessageTimeToLive()
    {
        using var browser = TestBrowserSubscription.Create();
        var handler = RecordingHandler.Answering(HttpStatusCode.Created);
        var message = PushMessage.Create(Payload, NotificationKey.ForTest(Guid.NewGuid()), NotificationRules.TestTimeToLive, NotificationUrgency.Normal);

        await CreateSender(handler).SendAsync(browser.Target, message);

        var request = Assert.Single(handler.Requests).Request;
        Assert.Equal(["normal"], request.Headers.TryGetValues("Urgency", out var urgency) ? urgency : ["normal"]);
        Assert.Equal("300", Assert.Single(request.Headers.GetValues("TTL")));
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Gone)]
    public async Task SendAsync_NotFoundOrGone_ReportsSubscriptionGone(HttpStatusCode status)
    {
        using var browser = TestBrowserSubscription.Create();

        var result = await CreateSender(RecordingHandler.Answering(status)).SendAsync(browser.Target, DoseMessage);

        Assert.Equal(new PushSendResult((int)status, null, PushSendStatus.SubscriptionGone), result);
    }

    [Theory]
    [InlineData(HttpStatusCode.BadRequest)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task SendAsync_BadRequestOrForbidden_ReportsSubscriptionInvalid(HttpStatusCode status)
    {
        using var browser = TestBrowserSubscription.Create();

        var result = await CreateSender(RecordingHandler.Answering(status)).SendAsync(browser.Target, DoseMessage);

        Assert.Equal(PushSendStatus.SubscriptionInvalid, result.Status);
    }

    [Fact]
    public async Task SendAsync_TooManyRequests_ReturnsRetryAfterWithoutRetryingItself()
    {
        using var browser = TestBrowserSubscription.Create();
        var handler = RecordingHandler.Answering(HttpStatusCode.TooManyRequests, response => response.Headers.Add("Retry-After", "120"));

        var result = await CreateSender(handler).SendAsync(browser.Target, DoseMessage);

        Assert.Equal(new PushSendResult(429, TimeSpan.FromMinutes(2), PushSendStatus.Retryable), result);
        Assert.Single(handler.Requests);
    }

    [Theory]
    [InlineData(HttpStatusCode.InternalServerError, PushSendStatus.Retryable)]
    [InlineData(HttpStatusCode.ServiceUnavailable, PushSendStatus.Retryable)]
    [InlineData(HttpStatusCode.RequestEntityTooLarge, PushSendStatus.Failed)]
    [InlineData(HttpStatusCode.OK, PushSendStatus.Sent)]
    public async Task SendAsync_OtherStatus_IsClassified(HttpStatusCode status, PushSendStatus expected)
    {
        using var browser = TestBrowserSubscription.Create();

        var result = await CreateSender(RecordingHandler.Answering(status)).SendAsync(browser.Target, DoseMessage);

        Assert.Equal(expected, result.Status);
    }

    [Fact]
    public async Task SendAsync_NetworkError_ReportsRetryableWithoutStatus()
    {
        using var browser = TestBrowserSubscription.Create();

        var result = await CreateSender(RecordingHandler.Throwing(new HttpRequestException("connection refused"))).SendAsync(browser.Target, DoseMessage);

        Assert.Equal(PushSendResult.NoResponse(), result);
    }

    [Fact]
    public async Task SendAsync_Timeout_ReportsRetryableWithoutStatus()
    {
        using var browser = TestBrowserSubscription.Create();

        var result = await CreateSender(RecordingHandler.Throwing(new TaskCanceledException("timed out"))).SendAsync(browser.Target, DoseMessage);

        Assert.Equal(PushSendResult.NoResponse(), result);
    }

    [Fact]
    public async Task SendAsync_CallerCancelled_Throws()
    {
        using var browser = TestBrowserSubscription.Create();
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            CreateSender(RecordingHandler.Answering(HttpStatusCode.Created)).SendAsync(browser.Target, DoseMessage, cancellation.Token));
    }

    [Fact]
    public async Task SendAsync_HostNotOnAllowlist_SendsNothing()
    {
        var handler = RecordingHandler.Answering(HttpStatusCode.Created);
        var target = TestBrowserSubscription.TargetAt("https://attacker.example.com/push");

        var result = await CreateSender(handler).SendAsync(target, DoseMessage);

        Assert.Equal(PushSendStatus.EndpointNotAllowed, result.Status);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task SendAsync_PushNotConfigured_Throws()
    {
        using var browser = TestBrowserSubscription.Create();
        var handler = RecordingHandler.Answering(HttpStatusCode.Created);

        await Assert.ThrowsAsync<InvalidOperationException>(() => CreateSender(handler, new PushOptions()).SendAsync(browser.Target, DoseMessage));
        Assert.Empty(handler.Requests);
    }

    private static WebPushSender CreateSender(HttpMessageHandler handler, PushOptions? options = null)
    {
        var effective = options ?? new PushOptions { Vapid = new PushVapidOptions { PublicKey = Vapid.PublicKey, PrivateKey = Vapid.PrivateKey, Subject = Subject } };
        return new WebPushSender(
            new HttpClient(handler),
            Options.Create(effective),
            PushEndpointAllowlist.Default,
            TimeProvider.System,
            NullLogger<WebPushSender>.Instance);
    }

    private static JsonElement VerifiedClaims(string jwt, string publicKey)
    {
        var parts = jwt.Split('.');
        var point = Base64Url.TryDecode(publicKey)!;
        using var key = ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = point[1..33], Y = point[33..65] } });
        Assert.True(key.VerifyData(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), Base64Url.TryDecode(parts[2])!, HashAlgorithmName.SHA256));
        return JsonDocument.Parse(Base64Url.TryDecode(parts[1])!).RootElement;
    }
}
