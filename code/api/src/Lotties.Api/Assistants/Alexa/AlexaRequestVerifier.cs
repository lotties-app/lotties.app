using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Lotties.Api.Assistants.Alexa;

/// <summary>Why a request's signature was accepted or refused (logged as a code; never the header values).</summary>
public enum AlexaVerification
{
    Valid,
    MissingHeaders,
    InvalidCertificateUrl,
    InvalidSignatureEncoding,
    CertificateUnavailable,
    CertificateNotTrusted,
    SignatureMismatch,
}

/// <summary>The signature headers of a request and its raw body, exactly as received.</summary>
public sealed record AlexaSignedRequest(string? CertificateChainUrl, string? Signature, ReadOnlyMemory<byte> Body);

/// <summary>Checks that a request was sent by Alexa (signature, certificate chain); the timestamp and skill id are checked on the parsed body.</summary>
public interface IAlexaRequestVerifier
{
    Task<AlexaVerification> VerifyAsync(AlexaSignedRequest request, CancellationToken cancellationToken = default);
}

/// <summary>The roots an Alexa certificate chain must end in: empty = the operating system's trusted roots (production).</summary>
public sealed class AlexaTrustAnchors
{
    public AlexaTrustAnchors(IEnumerable<X509Certificate2>? customRoots = null)
    {
        CustomRoots = (customRoots ?? []).ToArray();
    }

    public static AlexaTrustAnchors System { get; } = new();

    public IReadOnlyList<X509Certificate2> CustomRoots { get; }
}

/// <summary>
/// Amazon's request verification (host a custom skill as a web service): the <c>SignatureCertChainUrl</c> passes
/// <see cref="AlexaCertificateUrl"/>; the chain it names (downloaded and cached by <see cref="IAlexaCertificateChainProvider"/>)
/// has a leaf valid now whose subject alternative names include <see cref="EchoApiSubject"/>, and the chain builds to a
/// trusted root (<see cref="AlexaTrustAnchors"/>; revocation is not checked online); the <c>Signature-256</c> header (else
/// <c>Signature</c>) is the base64 RSA PKCS#1 SHA-256 signature of the raw body, verified with the leaf's public key.
/// </summary>
internal sealed class AlexaRequestVerifier(IAlexaCertificateChainProvider chains, AlexaTrustAnchors trust, TimeProvider timeProvider) : IAlexaRequestVerifier
{
    public const string EchoApiSubject = "echo-api.amazon.com";
    public const string CertificateChainUrlHeader = "SignatureCertChainUrl";
    public const string Signature256Header = "Signature-256";
    public const string SignatureHeader = "Signature";

    public async Task<AlexaVerification> VerifyAsync(AlexaSignedRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (string.IsNullOrWhiteSpace(request.CertificateChainUrl) || string.IsNullOrWhiteSpace(request.Signature))
        {
            return AlexaVerification.MissingHeaders;
        }

        if (!AlexaCertificateUrl.TryParse(request.CertificateChainUrl, out var url))
        {
            return AlexaVerification.InvalidCertificateUrl;
        }

        var signature = Decode(request.Signature);
        if (signature is null)
        {
            return AlexaVerification.InvalidSignatureEncoding;
        }

        var chain = await chains.GetAsync(url, cancellationToken);
        return chain is not { Count: > 0 } ? AlexaVerification.CertificateUnavailable : Verify(chain, signature, request.Body.Span);
    }

    private AlexaVerification Verify(X509Certificate2Collection chain, byte[] signature, ReadOnlySpan<byte> body)
    {
        var leaf = chain[0];
        if (!IsTrustedEchoCertificate(leaf, chain))
        {
            return AlexaVerification.CertificateNotTrusted;
        }

        using var key = leaf.GetRSAPublicKey();
        return key is not null && key.VerifyData(body, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)
            ? AlexaVerification.Valid
            : AlexaVerification.SignatureMismatch;
    }

    private bool IsTrustedEchoCertificate(X509Certificate2 leaf, X509Certificate2Collection chain)
    {
        var now = timeProvider.GetUtcNow().UtcDateTime;
        return leaf.NotBefore.ToUniversalTime() <= now
            && now <= leaf.NotAfter.ToUniversalTime()
            && NamesEchoApi(leaf)
            && BuildsToTrustedRoot(leaf, chain, now);
    }

    private static bool NamesEchoApi(X509Certificate2 leaf) =>
        leaf.Extensions.OfType<X509SubjectAlternativeNameExtension>()
            .SelectMany(extension => extension.EnumerateDnsNames())
            .Any(name => string.Equals(name, EchoApiSubject, StringComparison.OrdinalIgnoreCase));

    private bool BuildsToTrustedRoot(X509Certificate2 leaf, X509Certificate2Collection chain, DateTime now)
    {
        using var builder = new X509Chain();
        builder.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        builder.ChainPolicy.VerificationTime = now;
        builder.ChainPolicy.VerificationTimeIgnored = false;
        builder.ChainPolicy.ExtraStore.AddRange(new X509Certificate2Collection(chain.Skip(1).ToArray()));
        UseTrustAnchors(builder.ChainPolicy);
        var built = builder.Build(leaf);
        DisposeElements(builder);
        return built;
    }

    private void UseTrustAnchors(X509ChainPolicy policy)
    {
        if (trust.CustomRoots.Count == 0)
        {
            return;
        }

        policy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        policy.CustomTrustStore.AddRange(new X509Certificate2Collection(trust.CustomRoots.ToArray()));
    }

    private static void DisposeElements(X509Chain builder)
    {
        foreach (var element in builder.ChainElements)
        {
            element.Certificate.Dispose();
        }
    }

    private static byte[]? Decode(string signature)
    {
        var buffer = new byte[signature.Length];
        return Convert.TryFromBase64String(signature.Trim(), buffer, out var written) && written > 0 ? buffer[..written] : null;
    }
}
