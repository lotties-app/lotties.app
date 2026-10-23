using System.Text;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Tests.Support;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// Amazon's request verification with a certificate chain generated in the test: the certificate URL rules, the leaf's
/// validity and subject alternative name, the chain to a trusted root, and the SHA-256 signature over the raw body.
/// </summary>
public sealed class AlexaRequestVerifierTests : IDisposable
{
    private static readonly byte[] Body = Encoding.UTF8.GetBytes("""{"version":"1.0","request":{"type":"LaunchRequest"}}""");

    private readonly AlexaTestCertificates _certificates = new();

    public void Dispose() => _certificates.Dispose();

    [Fact]
    public async Task Verify_SignedByTheEchoCertificate_IsValid()
    {
        var result = await VerifyAsync(_certificates, AlexaTestCertificates.ChainUrl.AbsoluteUri, _certificates.Sign(Body), Body);

        Assert.Equal(AlexaVerification.Valid, result);
    }

    [Theory]
    [InlineData("https://s3.amazonaws.com/echo.api/echo-api-cert.pem", true)]
    [InlineData("https://s3.amazonaws.com:443/echo.api/echo-api-cert.pem", true)]
    [InlineData("HTTPS://s3.AmazonAWS.com/echo.api/echo-api-cert.pem", true)]
    [InlineData("https://s3.amazonaws.com/echo.api/../echo.api/echo-api-cert.pem", true)]
    [InlineData("http://s3.amazonaws.com/echo.api/echo-api-cert.pem", false)]
    [InlineData("https://notamazon.com/echo.api/echo-api-cert.pem", false)]
    [InlineData("https://s3.amazonaws.com.evil.test/echo.api/echo-api-cert.pem", false)]
    [InlineData("https://s3.amazonaws.com/EcHo.aPi/echo-api-cert.pem", false)]
    [InlineData("https://s3.amazonaws.com/invalid.path/echo-api-cert.pem", false)]
    [InlineData("https://s3.amazonaws.com:563/echo.api/echo-api-cert.pem", false)]
    [InlineData("https://user@s3.amazonaws.com/echo.api/echo-api-cert.pem", false)]
    [InlineData("/echo.api/echo-api-cert.pem", false)]
    public void CertificateUrl_FollowsAmazonsRules(string url, bool accepted)
    {
        Assert.Equal(accepted, AlexaCertificateUrl.TryParse(url, out _));
    }

    [Theory]
    [InlineData("https://notamazon.com/echo.api/echo-api-cert.pem")]
    [InlineData("https://s3.amazonaws.com/invalid.path/cert.pem")]
    [InlineData("https://s3.amazonaws.com:563/echo.api/cert.pem")]
    public async Task Verify_BadCertificateUrl_IsRefusedWithoutDownloading(string url)
    {
        var chains = new FixedChainProvider(_certificates.Chain);

        var result = await new AlexaRequestVerifier(chains, _certificates.Trust, TimeProvider.System).VerifyAsync(new AlexaSignedRequest(url, _certificates.Sign(Body), Body));

        Assert.Equal((AlexaVerification.InvalidCertificateUrl, 0), (result, chains.Requests));
    }

    [Fact]
    public async Task Verify_TamperedBody_IsSignatureMismatch()
    {
        var tampered = Encoding.UTF8.GetBytes("""{"version":"1.0","request":{"type":"IntentRequest"}}""");

        var result = await VerifyAsync(_certificates, AlexaTestCertificates.ChainUrl.AbsoluteUri, _certificates.Sign(Body), tampered);

        Assert.Equal(AlexaVerification.SignatureMismatch, result);
    }

    [Theory]
    [InlineData("not base64 !!")]
    [InlineData("====")]
    public async Task Verify_BadBase64_IsRefused(string signature)
    {
        var result = await VerifyAsync(_certificates, AlexaTestCertificates.ChainUrl.AbsoluteUri, signature, Body);

        Assert.Equal(AlexaVerification.InvalidSignatureEncoding, result);
    }

    [Fact]
    public async Task Verify_SignatureOfAnotherKey_IsSignatureMismatch()
    {
        using var other = new AlexaTestCertificates();

        var result = await VerifyAsync(_certificates, AlexaTestCertificates.ChainUrl.AbsoluteUri, other.Sign(Body), Body);

        Assert.Equal(AlexaVerification.SignatureMismatch, result);
    }

    [Theory]
    [InlineData(null, "c2ln")]
    [InlineData("https://s3.amazonaws.com/echo.api/echo-api-cert.pem", null)]
    [InlineData("", "")]
    public async Task Verify_MissingHeaders_IsRefused(string? url, string? signature)
    {
        var result = await VerifyAsync(_certificates, url, signature, Body);

        Assert.Equal(AlexaVerification.MissingHeaders, result);
    }

    [Fact]
    public async Task Verify_ExpiredLeaf_IsNotTrusted()
    {
        using var expired = new AlexaTestCertificates(notBefore: DateTimeOffset.UtcNow.AddDays(-30), notAfter: DateTimeOffset.UtcNow.AddDays(-1));

        var result = await VerifyAsync(expired, AlexaTestCertificates.ChainUrl.AbsoluteUri, expired.Sign(Body), Body);

        Assert.Equal(AlexaVerification.CertificateNotTrusted, result);
    }

    [Fact]
    public async Task Verify_LeafNotYetValid_IsNotTrusted()
    {
        using var future = new AlexaTestCertificates(notBefore: DateTimeOffset.UtcNow.AddDays(1), notAfter: DateTimeOffset.UtcNow.AddDays(30));

        var result = await VerifyAsync(future, AlexaTestCertificates.ChainUrl.AbsoluteUri, future.Sign(Body), Body);

        Assert.Equal(AlexaVerification.CertificateNotTrusted, result);
    }

    [Fact]
    public async Task Verify_LeafForAnotherName_IsNotTrusted()
    {
        using var wrongName = new AlexaTestCertificates(subjectAlternativeName: "echo-api.amazon.com.evil.test");

        var result = await VerifyAsync(wrongName, AlexaTestCertificates.ChainUrl.AbsoluteUri, wrongName.Sign(Body), Body);

        Assert.Equal(AlexaVerification.CertificateNotTrusted, result);
    }

    [Fact]
    public async Task Verify_ChainToAnUntrustedRoot_IsNotTrusted()
    {
        using var untrusted = new AlexaTestCertificates();
        var chains = new FixedChainProvider(untrusted.Chain);

        var result = await new AlexaRequestVerifier(chains, _certificates.Trust, TimeProvider.System)
            .VerifyAsync(new AlexaSignedRequest(AlexaTestCertificates.ChainUrl.AbsoluteUri, untrusted.Sign(Body), Body));

        Assert.Equal(AlexaVerification.CertificateNotTrusted, result);
    }

    [Fact]
    public async Task Verify_ValidityIsCheckedAgainstTheServerClock()
    {
        var chains = new FixedChainProvider(_certificates.Chain);
        var later = new FixedTimeProvider(DateTimeOffset.UtcNow.AddDays(60));

        var result = await new AlexaRequestVerifier(chains, _certificates.Trust, later)
            .VerifyAsync(new AlexaSignedRequest(AlexaTestCertificates.ChainUrl.AbsoluteUri, _certificates.Sign(Body), Body));

        Assert.Equal(AlexaVerification.CertificateNotTrusted, result);
    }

    [Fact]
    public async Task Verify_NoChain_IsCertificateUnavailable()
    {
        var result = await new AlexaRequestVerifier(new FixedChainProvider(null), _certificates.Trust, TimeProvider.System)
            .VerifyAsync(new AlexaSignedRequest(AlexaTestCertificates.ChainUrl.AbsoluteUri, _certificates.Sign(Body), Body));

        Assert.Equal(AlexaVerification.CertificateUnavailable, result);
    }

    private static Task<AlexaVerification> VerifyAsync(AlexaTestCertificates certificates, string? url, string? signature, byte[] body) =>
        new AlexaRequestVerifier(new FixedChainProvider(certificates.Chain), certificates.Trust, TimeProvider.System)
            .VerifyAsync(new AlexaSignedRequest(url, signature, body));
}
