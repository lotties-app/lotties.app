using System.Security.Cryptography;

namespace BabyRoutine.Infrastructure.Push;

/// <summary>A VAPID key pair as base64url raw P-256 keys.</summary>
public sealed record VapidKeyPair(string PublicKey, string PrivateKey)
{
    /// <summary>Never prints the private key.</summary>
    public override string ToString() => $"VapidKeyPair {{ PublicKey = {PublicKey} }}";
}

/// <summary>Generates and checks VAPID keys with <see cref="ECDsa"/> P-256 (no extra tooling).</summary>
public static class VapidKeys
{
    private const int PublicKeyBytes = 65;
    private const int PrivateKeyBytes = 32;
    private const byte UncompressedPointPrefix = 0x04;

    public static VapidKeyPair Generate()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var parameters = key.ExportParameters(includePrivateParameters: true);
        return new VapidKeyPair(Base64Url.Encode(UncompressedPoint(parameters.Q)), Base64Url.Encode(parameters.D));
    }

    /// <summary>
    /// The problem with a configured pair, or <c>null</c> when both keys are valid P-256 keys and the public key belongs
    /// to the private key. Messages never contain key material.
    /// </summary>
    public static string? FindProblem(string publicKey, string privateKey)
    {
        var publicBytes = Base64Url.TryDecode(publicKey);
        var privateBytes = Base64Url.TryDecode(privateKey);
        if (publicBytes is not { Length: PublicKeyBytes } || publicBytes[0] != UncompressedPointPrefix)
        {
            return "Push:Vapid:PublicKey must be a base64url uncompressed P-256 public key (65 bytes).";
        }

        if (privateBytes is not { Length: PrivateKeyBytes })
        {
            return "Push:Vapid:PrivateKey must be a base64url P-256 private key (32 bytes).";
        }

        var derived = TryDerivePublicKey(privateBytes);
        return derived is not null && CryptographicOperations.FixedTimeEquals(derived, publicBytes)
            ? null
            : "Push:Vapid:PublicKey does not match Push:Vapid:PrivateKey.";
    }

    private static byte[]? TryDerivePublicKey(byte[] privateKey)
    {
        try
        {
            using var key = ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, D = privateKey });
            return UncompressedPoint(key.ExportParameters(includePrivateParameters: false).Q);
        }
        catch (CryptographicException)
        {
            return null;
        }
    }

    private static byte[] UncompressedPoint(ECPoint point) => [UncompressedPointPrefix, .. point.X!, .. point.Y!];
}
