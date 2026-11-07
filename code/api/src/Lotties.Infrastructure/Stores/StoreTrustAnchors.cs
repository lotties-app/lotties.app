using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Infrastructure.Stores;

/// <summary>
/// The CA certificate(s) a user pasted for a provider that uses a private CA (docs/design/47-bring-your-own-database.md
/// section 3.2 step 5): PEM only, size-limited, parsed. They become the only trusted roots of that store's connections;
/// they never relax the host name check.
/// </summary>
public static class StoreTrustAnchors
{
    /// <summary>Largest PEM text accepted.</summary>
    public const int MaxPemLength = 16 * 1024;

    /// <summary>Most certificates in one PEM text.</summary>
    public const int MaxCertificates = 5;

    /// <summary>Parses the pasted PEM or throws <see cref="StoreEndpointRejectedException"/> (<c>endpoint_invalid_ca</c>).</summary>
    public static X509Certificate2Collection FromPem(string? pem)
    {
        if (string.IsNullOrWhiteSpace(pem) || pem.Length > MaxPemLength)
        {
            throw Invalid();
        }

        var certificates = Import(pem);
        return certificates.Count is > 0 and <= MaxCertificates ? certificates : throw Invalid();
    }

    private static X509Certificate2Collection Import(string pem)
    {
        var certificates = new X509Certificate2Collection();
        try
        {
            certificates.ImportFromPem(pem);
            return certificates;
        }
        catch (CryptographicException exception)
        {
            throw new StoreEndpointRejectedException(StoreEndpointFailure.InvalidCertificate, exception);
        }
    }

    private static StoreEndpointRejectedException Invalid() => new(StoreEndpointFailure.InvalidCertificate);
}
