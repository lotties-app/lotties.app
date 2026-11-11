using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Lotties.Application.SilentPush;
using Lotties.Domain.SilentPush;
using Lotties.Infrastructure.SilentPush;
using Lotties.Infrastructure.Tests.Push;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Tests.SilentPush;

/// <summary>Generated APNs and Google keys, options, fake HTTP and a log spy for the silent push senders (no real key or network).</summary>
internal sealed class SilentPushTestKit : IDisposable
{
    public const string ApnsToken = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
    public const string FcmToken = "fcm-token_abc:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8OvPVGJ-hQMRKRrZuJAEcl7B338qju59zJMjw2DELjzEvxwYv7hH5Ynpc1ODQ0aT4U4OFEeco8ohsN5PjL1iC2dNtk2BAokeMCg2ZXKqpc8FXKmhX94kIxQ";
    public const string ServiceAccountEmail = "lotties-push@lotties-test.iam.gserviceaccount.com";

    private SilentPushTestKit(ECDsa apnsKey, RSA googleKey)
    {
        ApnsKey = apnsKey;
        GoogleKey = googleKey;
        Clock = new ManualClock(new DateTimeOffset(2026, 11, 11, 9, 0, 0, TimeSpan.Zero));
    }

    public ECDsa ApnsKey { get; }

    public RSA GoogleKey { get; }

    public ManualClock Clock { get; }

    public LogSpy Logs { get; } = new();

    public static SilentPushTestKit Create() => new(ECDsa.Create(ECCurve.NamedCurves.nistP256), RSA.Create(2048));

    public static SilentPushTarget ApnsTarget(ApnsEnvironment environment = ApnsEnvironment.Production) =>
        new(Guid.NewGuid(), SilentPushChannel.Apns, ApnsToken, environment);

    public static SilentPushTarget FcmTarget() => new(Guid.NewGuid(), SilentPushChannel.Fcm, FcmToken, null);

    public static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    public string ServiceAccountJson(string? tokenUri = "https://oauth2.googleapis.com/token") =>
        JsonSerializer.Serialize(new Dictionary<string, string?>
        {
            ["type"] = "service_account",
            ["project_id"] = "lotties-test",
            ["client_email"] = ServiceAccountEmail,
            ["private_key"] = GoogleKey.ExportPkcs8PrivateKeyPem(),
            ["token_uri"] = tokenUri,
        });

    public SilentPushOptions Options(bool apns = true, bool fcm = true, string priority = SilentPushOptions.NormalPriority) => new()
    {
        Enabled = true,
        FcmPriority = priority,
        Apns = apns ? new SilentPushApnsOptions { KeyId = "ABC123DEFG", TeamId = "TEAM456789", PrivateKey = ApnsKey.ExportPkcs8PrivateKeyPem() } : new SilentPushApnsOptions(),
        Fcm = fcm ? new SilentPushFcmOptions { ProjectId = "lotties-test", ServiceAccountJson = ServiceAccountJson() } : new SilentPushFcmOptions(),
    };

    public SilentPushChannels Channels(SilentPushOptions options, RecordingHandler? oauth = null) =>
        new(Microsoft.Extensions.Options.Options.Create(options), new HandlerClientFactory(oauth ?? TokenEndpoint()), Clock, new SpyLoggerFactory(Logs));

    public ApnsSilentPushSender Apns(RecordingHandler handler, SilentPushOptions? options = null)
    {
        var value = options ?? Options();
        return new ApnsSilentPushSender(new HttpClient(handler), Channels(value), Microsoft.Extensions.Options.Options.Create(value), Clock, Logs.For<ApnsSilentPushSender>());
    }

    public FcmSilentPushSender Fcm(RecordingHandler handler, RecordingHandler? oauth = null, SilentPushOptions? options = null)
    {
        var value = options ?? Options();
        return new FcmSilentPushSender(new HttpClient(handler), Channels(value, oauth), Microsoft.Extensions.Options.Options.Create(value), Logs.For<FcmSilentPushSender>());
    }

    /// <summary>Google's token endpoint answering one access token valid for an hour.</summary>
    public static RecordingHandler TokenEndpoint(string accessToken = "ya29.test-access-token") =>
        new(_ => Json(HttpStatusCode.OK, $$"""{"access_token":"{{accessToken}}","expires_in":3600,"token_type":"Bearer"}"""));

    public void Dispose()
    {
        ApnsKey.Dispose();
        GoogleKey.Dispose();
    }

    private sealed class HandlerClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}

internal sealed class ManualClock(DateTimeOffset start) : TimeProvider
{
    private DateTimeOffset _now = start;

    public override DateTimeOffset GetUtcNow() => _now;

    public void Advance(TimeSpan by) => _now += by;
}

/// <summary>Every formatted log message of every category, to prove no token or key is ever logged.</summary>
internal sealed class LogSpy
{
    private readonly List<string> _messages = [];

    public IReadOnlyList<string> Messages
    {
        get
        {
            lock (_messages)
            {
                return _messages.ToArray();
            }
        }
    }

    public ILogger<T> For<T>() => new SpyLogger<T>(this);

    public void Add(string message)
    {
        lock (_messages)
        {
            _messages.Add(message);
        }
    }

    private sealed class SpyLogger<T>(LogSpy spy) : ILogger<T>
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            spy.Add($"{logLevel}: {formatter(state, exception)} {exception}");
    }
}

internal sealed class SpyLoggerFactory(LogSpy spy) : ILoggerFactory
{
    public void AddProvider(ILoggerProvider provider)
    {
    }

    public ILogger CreateLogger(string categoryName) => spy.For<object>();

    public void Dispose()
    {
    }
}
