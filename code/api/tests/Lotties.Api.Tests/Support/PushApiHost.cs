using System.Collections.Concurrent;
using Lotties.Application.Push;
using Lotties.Domain.Notifications;
using Lotties.Infrastructure.Push;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// The test API with push configured (a generated VAPID pair) and a <see cref="FakePushSender"/> instead of the Web
/// Push client; same throw-away SQLite database as <see cref="ApiFactory"/> (seed through <see cref="Factory"/>).
/// </summary>
public sealed class PushApiHost : IDisposable
{
    /// <summary>The shared host; the anonymous action limit is raised because test requests share one remote address.</summary>
    public PushApiHost()
        : this([("RequestLimits:PushActionPermitsPerMinute", "1000")])
    {
    }

    private PushApiHost(IReadOnlyList<(string Key, string Value)> settings)
    {
        Factory = new ApiFactory();
        Sender = new FakePushSender();
        Vapid = VapidKeys.Generate();
        Host = Factory.WithWebHostBuilder(builder => Configure(builder, settings));
    }

    internal ApiFactory Factory { get; }

    internal WebApplicationFactory<Program> Host { get; }

    internal FakePushSender Sender { get; }

    internal VapidKeyPair Vapid { get; }

    /// <summary>A separate host with extra settings (e.g. low rate limits); dispose it after the test.</summary>
    internal static PushApiHost With(params (string Key, string Value)[] settings) => new(settings);

    public HttpClient ClientFor(string subject)
    {
        var client = Host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        return client;
    }

    public HttpClient AnonymousClient() => Host.CreateClient();

    public void Dispose()
    {
        Host.Dispose();
        Factory.Dispose();
    }

    private void Configure(IWebHostBuilder builder, IReadOnlyList<(string Key, string Value)> settings)
    {
        builder.UseSetting("Push:Vapid:PublicKey", Vapid.PublicKey);
        builder.UseSetting("Push:Vapid:PrivateKey", Vapid.PrivateKey);
        builder.UseSetting("Push:Vapid:Subject", "mailto:operator@example.test");
        builder.UseSetting("Push:SchedulerEnabled", "false");
        foreach (var (key, value) in settings)
        {
            builder.UseSetting(key, value);
        }

        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IPushSender>();
            services.AddSingleton<IPushSender>(Sender);
        });
    }
}

/// <summary>Records every push; answers 201 unless a status was scripted for the endpoint.</summary>
internal sealed class FakePushSender : IPushSender
{
    private readonly ConcurrentDictionary<string, PushSendResult> _scripted = new(StringComparer.Ordinal);

    public ConcurrentQueue<(PushTarget Target, PushMessage Message)> Sent { get; } = new();

    public void Answer(string endpoint, PushSendResult result) => _scripted[endpoint] = result;

    public IReadOnlyList<PushMessage> SentTo(string endpoint) =>
        Sent.Where(sent => sent.Target.Endpoint.Value == endpoint).Select(sent => sent.Message).ToArray();

    public Task<PushSendResult> SendAsync(PushTarget target, PushMessage message, CancellationToken cancellationToken = default)
    {
        Sent.Enqueue((target, message));
        return Task.FromResult(_scripted.GetValueOrDefault(target.Endpoint.Value) ?? PushSendResult.FromStatusCode(201));
    }
}

/// <summary>Browser subscription bodies for push tests.</summary>
internal static class PushTestData
{
    public static readonly string P256dh = Base64Url([0x04, .. Enumerable.Range(1, 64).Select(value => (byte)value)]);

    public static readonly string Auth = Base64Url(Enumerable.Range(100, 16).Select(value => (byte)value).ToArray());

    public static string NewEndpoint() => $"https://fcm.googleapis.com/fcm/send/{Guid.NewGuid():N}";

    public static object SubscriptionBody(string endpoint, string locale = "pt-BR", string? deviceLabel = "Chrome on Android", string? p256dh = null) => new
    {
        endpoint,
        expirationTime = (long?)null,
        keys = new { p256dh = p256dh ?? P256dh, auth = Auth },
        locale,
        deviceLabel,
    };

    public static PushKeys Keys => PushKeys.Create(P256dh, Auth);

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
