using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Lotties.Api.Assistants.Alexa;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// A throw-away certificate chain made inside the test (never Amazon's): a self-signed root CA and an Echo-like leaf it
/// signs, with the subject alternative name and validity each test chooses, and the leaf's key to sign bodies.
/// </summary>
internal sealed class AlexaTestCertificates : IDisposable
{
    public static readonly Uri ChainUrl = new("https://s3.amazonaws.com/echo.api/echo-api-cert-test.pem");

    private readonly RSA _rootKey = RSA.Create(2048);
    private readonly RSA _leafKey = RSA.Create(2048);

    public AlexaTestCertificates(string subjectAlternativeName = AlexaRequestVerifier.EchoApiSubject, DateTimeOffset? notBefore = null, DateTimeOffset? notAfter = null)
    {
        var from = notBefore ?? DateTimeOffset.UtcNow.AddDays(-1);
        var until = notAfter ?? DateTimeOffset.UtcNow.AddDays(30);
        Root = CreateRoot(_rootKey, "CN=Lotties Test Root");
        Leaf = CreateLeaf(subjectAlternativeName, from, until);
    }

    public X509Certificate2 Root { get; }

    public X509Certificate2 Leaf { get; }

    /// <summary>The chain as Amazon serves it: leaf first, then the issuer.</summary>
    public X509Certificate2Collection Chain => [Leaf, Root];

    public AlexaTrustAnchors Trust => new([Root]);

    public string Sign(byte[] body) => Convert.ToBase64String(_leafKey.SignData(body, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));

    public string Pem() => Leaf.ExportCertificatePem() + "\n" + Root.ExportCertificatePem() + "\n";

    public void Dispose()
    {
        Leaf.Dispose();
        Root.Dispose();
        _leafKey.Dispose();
        _rootKey.Dispose();
    }

    private static X509Certificate2 CreateRoot(RSA key, string subject)
    {
        var request = new CertificateRequest(subject, key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign, true));
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false));
        return request.CreateSelfSigned(DateTimeOffset.UtcNow.AddYears(-1), DateTimeOffset.UtcNow.AddYears(5));
    }

    private X509Certificate2 CreateLeaf(string subjectAlternativeName, DateTimeOffset notBefore, DateTimeOffset notAfter)
    {
        var request = new CertificateRequest($"CN={subjectAlternativeName}", _leafKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var names = new SubjectAlternativeNameBuilder();
        names.AddDnsName(subjectAlternativeName);
        request.CertificateExtensions.Add(names.Build());
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(false, false, 0, false));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature, true));
        request.CertificateExtensions.Add(X509AuthorityKeyIdentifierExtension.CreateFromCertificate(Root, true, false));
        var serial = RandomNumberGenerator.GetBytes(12);
        using var issued = request.Create(Root, notBefore, notAfter, serial);
        return new X509Certificate2(issued.RawData);
    }
}

/// <summary>Serves one fixed chain for the Echo URL and counts the downloads (a stand-in for the HTTP download).</summary>
internal sealed class FixedChainProvider(X509Certificate2Collection? chain) : IAlexaCertificateChainProvider
{
    public int Requests { get; private set; }

    public Task<X509Certificate2Collection?> GetAsync(Uri url, CancellationToken cancellationToken = default)
    {
        Requests++;
        return Task.FromResult(chain);
    }
}
