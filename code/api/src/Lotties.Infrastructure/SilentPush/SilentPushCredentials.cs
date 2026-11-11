using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Lotties.Infrastructure.SilentPush;

/// <summary>Reads secret values given as their text or as the base64 of that text (how a multi-line file fits an env variable).</summary>
internal static class SecretText
{
    public static string Decode(string value)
    {
        var trimmed = value.Trim();
        if (trimmed.StartsWith('-') || trimmed.StartsWith('{'))
        {
            return trimmed;
        }

        var buffer = new byte[trimmed.Length];
        return Convert.TryFromBase64String(trimmed, buffer, out var written) ? Encoding.UTF8.GetString(buffer, 0, written).Trim() : trimmed;
    }
}

/// <summary>The APNs auth key: a P-256 private key from the <c>.p8</c> file (PEM PKCS#8), with its key id and team id.</summary>
internal sealed class ApnsSigningKey : IDisposable
{
    private ApnsSigningKey(ECDsa key, string keyId, string teamId)
    {
        Key = key;
        KeyId = keyId;
        TeamId = teamId;
    }

    public ECDsa Key { get; }

    public string KeyId { get; }

    public string TeamId { get; }

    /// <summary>The key of <paramref name="options"/>, or <c>null</c> with <paramref name="problem"/> saying which setting is wrong (never its value).</summary>
    public static ApnsSigningKey? TryCreate(SilentPushApnsOptions options, out string? problem)
    {
        ArgumentNullException.ThrowIfNull(options);
        var key = ImportKey(SecretText.Decode(options.PrivateKey ?? string.Empty));
        problem = key is null ? $"{SilentPushEnvironmentVariables.ApnsPrivateKey} is not a P-256 private key in PKCS#8 PEM (the .p8 file) or its base64." : null;
        return key is null ? null : new ApnsSigningKey(key, options.KeyId!.Trim(), options.TeamId!.Trim());
    }

    public void Dispose() => Key.Dispose();

    public override string ToString() => "[apns signing key]";

    private static ECDsa? ImportKey(string pem)
    {
        var key = ECDsa.Create();
        try
        {
            key.ImportFromPem(pem);
            return key.KeySize == 256 ? key : Discard(key);
        }
        catch (Exception exception) when (exception is ArgumentException or CryptographicException)
        {
            return Discard(key);
        }
    }

    private static ECDsa? Discard(ECDsa key)
    {
        key.Dispose();
        return null;
    }
}

/// <summary>
/// A Google service account from its key file: the e-mail, the RSA private key and the token endpoint (only Google's own,
/// <see cref="TokenEndpoint"/>: a key file naming another host is refused, so the key never goes elsewhere).
/// </summary>
internal sealed class GoogleServiceAccount : IDisposable
{
    public static readonly Uri TokenEndpoint = new("https://oauth2.googleapis.com/token");

    private GoogleServiceAccount(string clientEmail, RSA key)
    {
        ClientEmail = clientEmail;
        Key = key;
    }

    public string ClientEmail { get; }

    public RSA Key { get; }

    /// <summary>The account of <paramref name="options"/>, or <c>null</c> with <paramref name="problem"/> saying what is wrong (never a value).</summary>
    public static GoogleServiceAccount? TryCreate(SilentPushFcmOptions options, out string? problem)
    {
        ArgumentNullException.ThrowIfNull(options);
        var fields = ReadFields(SecretText.Decode(options.ServiceAccountJson ?? string.Empty));
        var key = fields?.PrivateKey is { } pem ? ImportKey(pem) : null;
        problem = Problem(fields, key);
        return problem is null && fields is not null && key is not null ? new GoogleServiceAccount(fields.ClientEmail, key) : Discard(key);
    }

    public void Dispose() => Key.Dispose();

    public override string ToString() => "[google service account]";

    private static string? Problem(KeyFields? fields, RSA? key) => (fields, key) switch
    {
        (null, _) => $"{SilentPushEnvironmentVariables.FcmServiceAccount} is not a service-account key file (JSON with client_email and private_key) or its base64.",
        (_, null) => $"{SilentPushEnvironmentVariables.FcmServiceAccount} has a private_key that is not an RSA key in PEM.",
        ({ TokenUri: { } uri }, _) when uri != TokenEndpoint.AbsoluteUri => $"{SilentPushEnvironmentVariables.FcmServiceAccount} names a token_uri other than {TokenEndpoint}.",
        _ => null,
    };

    private static KeyFields? ReadFields(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            var email = Text(root, "client_email");
            var pem = Text(root, "private_key");
            return email is null || pem is null ? null : new KeyFields(email, pem, Text(root, "token_uri"));
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? Text(JsonElement root, string name) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(value.GetString())
            ? value.GetString()
            : null;

    private static RSA? ImportKey(string pem)
    {
        var key = RSA.Create();
        try
        {
            key.ImportFromPem(pem);
            return key;
        }
        catch (Exception exception) when (exception is ArgumentException or CryptographicException)
        {
            key.Dispose();
            return null;
        }
    }

    private static GoogleServiceAccount? Discard(RSA? key)
    {
        key?.Dispose();
        return null;
    }

    private sealed record KeyFields(string ClientEmail, string PrivateKey, string? TokenUri);
}
