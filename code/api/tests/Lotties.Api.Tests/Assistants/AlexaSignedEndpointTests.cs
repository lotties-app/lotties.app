using System.Net;
using System.Text;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Tests.Support;
using static Lotties.Api.Tests.Assistants.AlexaRequests;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The endpoint with the real <see cref="AlexaRequestVerifier"/>: only the chain download is replaced (it serves a chain
/// generated in the test, whose root is trusted), so the URL rules, the certificate checks and the signature over the raw
/// body run exactly as in production.
/// </summary>
public sealed class AlexaSignedEndpointTests : IDisposable
{
    private readonly AlexaTestCertificates _certificates = new();
    private readonly AlexaApiHost _host;

    public AlexaSignedEndpointTests()
    {
        _host = AlexaApiHost.WithRealVerifier(_certificates);
    }

    public void Dispose()
    {
        _host.Dispose();
        _certificates.Dispose();
    }

    [Fact]
    public async Task Post_SignedByTheTestEchoCertificate_IsAnswered()
    {
        var baby = await _host.Factory.SeedBabyAsync();
        var body = Intent("DiapersTodayIntent", _host.TokenFor(baby.OwnerSubject));

        var json = await AlexaApiHost.ReadAsync(await _host.PostAsync(body, Headers(_certificates.Sign(Encoding.UTF8.GetBytes(body)))));

        Assert.Equal("Lia has had no diapers in the last 24 hours.", AlexaApiHost.Speech(json));
    }

    [Fact]
    public async Task Post_LegacySignatureHeaderWithSha256_IsAccepted()
    {
        var body = Launch();
        var headers = new[] { (AlexaRequestVerifier.CertificateChainUrlHeader, AlexaTestCertificates.ChainUrl.AbsoluteUri), (AlexaRequestVerifier.SignatureHeader, _certificates.Sign(Encoding.UTF8.GetBytes(body))) };

        var response = await _host.PostAsync(body, headers);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Post_BodyChangedAfterSigning_Is400()
    {
        var body = Launch();
        var signature = _certificates.Sign(Encoding.UTF8.GetBytes(body));

        var response = await _host.PostAsync(body.Replace("LaunchRequest", "IntentRequest", StringComparison.Ordinal), Headers(signature));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("https://s3.amazonaws.com.evil.test/echo.api/cert.pem")]
    [InlineData("https://s3.amazonaws.com/other/cert.pem")]
    [InlineData("https://s3.amazonaws.com:8443/echo.api/cert.pem")]
    public async Task Post_CertificateUrlOutsideAmazonsRules_Is400(string url)
    {
        var body = Launch();
        var headers = new[] { (AlexaRequestVerifier.CertificateChainUrlHeader, url), (AlexaRequestVerifier.Signature256Header, _certificates.Sign(Encoding.UTF8.GetBytes(body))) };

        var response = await _host.PostAsync(body, headers);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Post_BadBase64Signature_Is400()
    {
        var body = Launch();

        var response = await _host.PostAsync(body, Headers("@@not-base64@@"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static (string Name, string Value)[] Headers(string signature) =>
    [
        (AlexaRequestVerifier.CertificateChainUrlHeader, AlexaTestCertificates.ChainUrl.AbsoluteUri),
        (AlexaRequestVerifier.Signature256Header, signature),
    ];
}
