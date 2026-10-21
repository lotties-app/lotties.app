using System.Net;
using System.Security.Cryptography;
using System.Text;
using BabyRoutine.Application.Push;
using BabyRoutine.Domain.Notifications;
using BabyRoutine.Infrastructure.Push;

namespace BabyRoutine.Infrastructure.Tests.Push;

/// <summary>A browser subscription for tests: its P-256 key pair and auth secret, so a test can decrypt what was sent.</summary>
internal sealed class TestBrowserSubscription : IDisposable
{
    private const string EndpointUrl = "https://fcm.googleapis.com/fcm/send/test-subscription";

    private TestBrowserSubscription(ECDiffieHellman key, byte[] authSecret)
    {
        Key = key;
        AuthSecret = authSecret;
        PublicKey = UncompressedPoint(key.ExportParameters(includePrivateParameters: false).Q);
        Target = new PushTarget(PushEndpoint.From(EndpointUrl), PushKeys.Create(Base64Url.Encode(PublicKey), Base64Url.Encode(authSecret)));
    }

    public ECDiffieHellman Key { get; }

    public byte[] AuthSecret { get; }

    public byte[] PublicKey { get; }

    public PushTarget Target { get; }

    public static TestBrowserSubscription Create() =>
        new(ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256), RandomNumberGenerator.GetBytes(16));

    public static PushTarget TargetAt(string endpoint)
    {
        using var subscription = Create();
        return subscription.Target with { Endpoint = PushEndpoint.From(endpoint) };
    }

    /// <summary>Decrypts an RFC 8291 <c>aes128gcm</c> body (single record) as the user agent would.</summary>
    public string Decrypt(byte[] body)
    {
        var salt = body[..16];
        var keyIdLength = body[20];
        var serverPublicKey = body[21..(21 + keyIdLength)];
        var ciphertext = body[(21 + keyIdLength)..];

        using var serverKey = ECDiffieHellman.Create(new ECParameters
        {
            Curve = ECCurve.NamedCurves.nistP256,
            Q = new ECPoint { X = serverPublicKey[1..33], Y = serverPublicKey[33..65] },
        });
        var sharedSecret = Key.DeriveRawSecretAgreement(serverKey.PublicKey);
        var keyInfo = Encoding.ASCII.GetBytes("WebPush: info\0").Concat(PublicKey).Concat(serverPublicKey).ToArray();
        var inputKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, sharedSecret, 32, AuthSecret, keyInfo);
        var contentKey = HKDF.DeriveKey(HashAlgorithmName.SHA256, inputKey, 16, salt, Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"));
        var nonce = HKDF.DeriveKey(HashAlgorithmName.SHA256, inputKey, 12, salt, Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"));

        var plaintext = new byte[ciphertext.Length - 16];
        using var aes = new AesGcm(contentKey, 16);
        aes.Decrypt(nonce, ciphertext[..^16], ciphertext[^16..], plaintext);
        var padded = plaintext.AsSpan().TrimEnd((byte)0);
        Assert.Equal(0x02, padded[^1]);
        return Encoding.UTF8.GetString(padded[..^1]);
    }

    public void Dispose() => Key.Dispose();

    private static byte[] UncompressedPoint(ECPoint point) => [0x04, .. point.X!, .. point.Y!];
}

/// <summary>Records each request (with its body read eagerly) and answers with a scripted response or exception.</summary>
internal sealed class RecordingHandler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
{
    public List<RecordedRequest> Requests { get; } = [];

    public static RecordingHandler Answering(HttpStatusCode status, Action<HttpResponseMessage>? configure = null) =>
        new(_ =>
        {
            var response = new HttpResponseMessage(status);
            configure?.Invoke(response);
            return response;
        });

    public static RecordingHandler Throwing(Exception exception) => new(_ => throw exception);

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var body = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken);
        Requests.Add(new RecordedRequest(request, body));
        cancellationToken.ThrowIfCancellationRequested();
        return respond(request);
    }
}

internal sealed record RecordedRequest(HttpRequestMessage Request, byte[] Body);
