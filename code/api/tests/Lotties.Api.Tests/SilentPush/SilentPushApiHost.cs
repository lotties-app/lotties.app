using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.SilentPush;
using Lotties.Domain.SilentPush;
using Lotties.Infrastructure.SilentPush;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Lotties.Api.Tests.SilentPush;

/// <summary>
/// The test API with silent pushes on, both channels configured with generated keys, no debounce or interval, the worker off
/// (tests run passes with <see cref="RunPassAsync"/>) and a <see cref="FakeSilentPushSender"/>; same throw-away SQLite
/// database as <see cref="ApiFactory"/>.
/// </summary>
public sealed class SilentPushApiHost : IDisposable
{
    public SilentPushApiHost()
        : this(enabled: true)
    {
    }

    private SilentPushApiHost(bool enabled)
    {
        Factory = new ApiFactory();
        Sender = new FakeSilentPushSender();
        using var apnsKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        using var googleKey = RSA.Create(2048);
        var apnsPem = apnsKey.ExportPkcs8PrivateKeyPem();
        var serviceAccount = JsonSerializer.Serialize(new { client_email = "push@lotties-test.iam.gserviceaccount.com", private_key = googleKey.ExportPkcs8PrivateKeyPem() });
        Host = Factory.WithWebHostBuilder(builder =>
        {
            builder.UseSetting("SilentPush:Enabled", enabled ? "true" : "false");
            builder.UseSetting("SilentPush:WorkerEnabled", "false");
            builder.UseSetting("SilentPush:DebounceSeconds", "0");
            builder.UseSetting("SilentPush:MinIntervalSeconds", "0");
            builder.UseSetting("SilentPush:MaxDevicesPerUser", "3");
            builder.UseSetting("SilentPush:Apns:KeyId", "ABC123DEFG");
            builder.UseSetting("SilentPush:Apns:TeamId", "TEAM456789");
            builder.UseSetting("SilentPush:Apns:PrivateKey", apnsPem);
            builder.UseSetting("SilentPush:Fcm:ProjectId", "lotties-test");
            builder.UseSetting("SilentPush:Fcm:ServiceAccountJson", serviceAccount);
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<ISilentPushSender>();
                services.AddSingleton<ISilentPushSender>(Sender);
            });
        });
    }

    internal ApiFactory Factory { get; }

    internal WebApplicationFactory<Program> Host { get; }

    internal FakeSilentPushSender Sender { get; }

    /// <summary>A host with silent pushes off; dispose it after the test.</summary>
    internal static SilentPushApiHost Off() => new(enabled: false);

    public HttpClient ClientFor(string subject, Guid? device = null)
    {
        var client = Host.CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, subject);
        if (device is { } id)
        {
            client.DefaultRequestHeaders.Add("Lotties-Push-Device", id.ToString());
        }

        return client;
    }

    /// <summary>One worker pass a second from now (no debounce in this host: everything queued is due).</summary>
    public Task<int> RunPassAsync() => Host.Services.GetRequiredService<ISilentPushTick>().RunOnceAsync(DateTimeOffset.UtcNow.AddSeconds(1));

    public void Dispose()
    {
        Host.Dispose();
        Factory.Dispose();
    }
}

/// <summary>Records every silent push; answers sent unless an outcome was scripted for the device.</summary>
internal sealed class FakeSilentPushSender : ISilentPushSender
{
    private readonly ConcurrentDictionary<Guid, SilentPushOutcome> _scripted = new();

    public ConcurrentQueue<SilentPushTarget> Sent { get; } = new();

    public void Answer(Guid deviceId, SilentPushOutcome outcome) => _scripted[deviceId] = outcome;

    public int CountTo(Guid deviceId) => Sent.Count(target => target.DeviceId == deviceId);

    public Task<SilentPushOutcome> SendAsync(SilentPushTarget target, CancellationToken cancellationToken = default)
    {
        Sent.Enqueue(target);
        return Task.FromResult(_scripted.GetValueOrDefault(target.DeviceId, SilentPushOutcome.Sent));
    }
}

internal static class SilentPushTestData
{
    public static string NewApnsToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();

    public static string NewFcmToken() => "fcm_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(60));

    public static object ApnsBody(string token, string environment = "production") => new { channel = "apns", token, apnsEnvironment = environment };

    public static object FcmBody(string token) => new { channel = "fcm", token };
}
