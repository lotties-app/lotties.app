using System.Security.Cryptography;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Stores;

/// <summary>How the server certificate of a store is checked. TLS is always required and always verified.</summary>
public enum StoreSslMode
{
    /// <summary>The chain must be trusted (system roots, or the pasted CA) and the certificate must name the typed host.</summary>
    VerifyFull = 1,
}

/// <summary>
/// The TLS policy of a store (docs/design/47-bring-your-own-database.md section 3.2 step 5): a verified chain only, plus
/// an optional CA certificate the user pastes for providers whose pooler uses a private CA. Shape only: the PEM must hold
/// one or more well-formed <c>CERTIFICATE</c> blocks and nothing else; building the chain is the connection layer's job.
/// </summary>
public sealed record StoreTlsPolicy
{
    /// <summary>Room for a short chain of a few certificates.</summary>
    public const int MaxCaCertificatePemLength = 32 * 1024;

    private const string CertificateLabel = "CERTIFICATE";
    private const string CaField = "tls.caCertificatePem";

    private StoreTlsPolicy(StoreSslMode sslMode, string? caCertificatePem)
    {
        SslMode = sslMode;
        CaCertificatePem = caCertificatePem;
    }

    public StoreSslMode SslMode { get; }

    /// <summary>The pasted CA certificate(s) in PEM form, or null to trust the system roots only.</summary>
    public string? CaCertificatePem { get; }

    public static StoreTlsPolicy Create(StoreSslMode sslMode, string? caCertificatePem) =>
        new(EnsureDefined(sslMode), NormalizeCa(caCertificatePem));

    public override string ToString() =>
        $"{nameof(StoreTlsPolicy)} {{ SslMode = {SslMode}, CustomCa = {CaCertificatePem is not null} }}";

    private static StoreSslMode EnsureDefined(StoreSslMode sslMode) =>
        Enum.IsDefined(sslMode)
            ? sslMode
            : throw new DomainValidationException("tls.sslMode", "tls.sslMode is not a supported mode.");

    private static string? NormalizeCa(string? pem)
    {
        var trimmed = pem?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        if (trimmed.Length > MaxCaCertificatePemLength)
        {
            throw new DomainValidationException(CaField, $"{CaField} must be at most {MaxCaCertificatePemLength} characters.");
        }

        return HoldsOnlyCertificates(trimmed)
            ? trimmed
            : throw new DomainValidationException(CaField, $"{CaField} must hold PEM CERTIFICATE blocks only.");
    }

    private static bool HoldsOnlyCertificates(string pem)
    {
        var remaining = pem.AsSpan();
        var blocks = 0;
        while (PemEncoding.TryFind(remaining, out var fields))
        {
            if (!IsCertificateBlock(remaining, fields))
            {
                return false;
            }

            remaining = remaining[fields.Location.End..];
            blocks++;
        }

        return blocks > 0 && remaining.Trim().IsEmpty;
    }

    private static bool IsCertificateBlock(ReadOnlySpan<char> text, PemFields fields) =>
        text[fields.Label].SequenceEqual(CertificateLabel)
        && fields.DecodedDataLength > 0
        && text[..fields.Location.Start].Trim().IsEmpty;
}
