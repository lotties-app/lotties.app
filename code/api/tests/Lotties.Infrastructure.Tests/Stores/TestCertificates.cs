using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>In-memory test CAs and server certificates (ECDSA P-256), never written to a certificate store.</summary>
internal static class TestCertificates
{
    public static X509Certificate2 CreateCa(string commonName)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={commonName}", key, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
        var now = DateTimeOffset.UtcNow;
        return request.CreateSelfSigned(now.AddDays(-1), now.AddDays(30));
    }

    public static X509Certificate2 CreateServer(X509Certificate2 issuer, string dnsName)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest($"CN={dnsName}", key, HashAlgorithmName.SHA256);
        var names = new SubjectAlternativeNameBuilder();
        names.AddDnsName(dnsName);
        request.CertificateExtensions.Add(names.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension([new Oid("1.3.6.1.5.5.7.3.1")], false));
        request.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(issuer, true, false));
        var now = DateTimeOffset.UtcNow;
        var serial = RandomNumberGenerator.GetBytes(16);
        using var signed = request.Create(issuer, now.AddHours(-1), now.AddDays(7), serial);
        using var withKey = signed.CopyWithPrivateKey(key);
        return X509CertificateLoader.LoadPkcs12(withKey.Export(X509ContentType.Pfx), null);
    }

    public static string ToPem(X509Certificate2 certificate) => certificate.ExportCertificatePem();
}
