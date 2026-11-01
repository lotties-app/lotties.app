using System.Net;
using System.Text;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Tests.Support;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Tests.Assistants;

/// <summary>The <c>Alexa</c> settings (startup validation, skill ids from one variable) and the cached certificate chain download.</summary>
public sealed class AlexaConfigurationTests : IDisposable
{
    private const string SkillId = "amzn1.ask.skill.11111111-2222-3333-4444-555555555555";

    private readonly AlexaTestCertificates _certificates = new();

    public void Dispose() => _certificates.Dispose();

    [Fact]
    public void Validate_DisabledDefaults_Pass() =>
        Assert.True(new AlexaOptionsValidator().Validate(null, new AlexaOptions()).Succeeded);

    [Fact]
    public void Validate_EnabledWithoutSkillIds_Fails()
    {
        var result = new AlexaOptionsValidator().Validate(null, new AlexaOptions { Enabled = true });

        Assert.True(result.Failed);
        Assert.Contains("Alexa:SkillIds", result.FailureMessage, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("amzn1.ask.skill.not-a-uuid")]
    [InlineData("11111111-2222-3333-4444-555555555555")]
    public void Validate_MalformedSkillId_Fails(string id) =>
        Assert.True(new AlexaOptionsValidator().Validate(null, new AlexaOptions { Enabled = true, SkillIds = [id] }).Failed);

    [Theory]
    [InlineData(0, 5, 65536, 131072)]
    [InlineData(60, 0, 65536, 131072)]
    [InlineData(60, 5, 10, 131072)]
    [InlineData(60, 5, 65536, 5 * 1024 * 1024)]
    public void Validate_LimitOutOfRange_Fails(int cacheMinutes, int timeoutSeconds, int certBytes, int bodyBytes) =>
        Assert.True(new AlexaOptionsValidator().Validate(null, new AlexaOptions
        {
            CertCacheMinutes = cacheMinutes,
            CertDownloadTimeoutSeconds = timeoutSeconds,
            CertMaxBytes = certBytes,
            MaxRequestBodyBytes = bodyBytes,
        }).Failed);

    [Fact]
    public void SkillIds_OneCommaSeparatedVariable_AreAdded()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection([KeyValuePair.Create<string, string?>("Alexa:SkillIds", $" {SkillId} , amzn1.ask.skill.aaaaaaaa-2222-3333-4444-555555555555")])
            .Build();
        var options = new AlexaOptions();

        new AlexaSkillIdsFromText(configuration).PostConfigure(null, options);

        Assert.Equal(2, options.SkillIds.Count);
        Assert.True(options.IsSkill(SkillId));
        Assert.False(options.IsSkill("amzn1.ask.skill.99999999-2222-3333-4444-555555555555"));
        Assert.False(options.IsSkill(null));
    }

    [Fact]
    public async Task ChainDownload_IsCachedPerUrl()
    {
        var handler = new PemHandler(HttpStatusCode.OK, _certificates.Pem());
        var provider = Provider(handler);

        var first = await provider.GetAsync(AlexaTestCertificates.ChainUrl);
        var second = await provider.GetAsync(AlexaTestCertificates.ChainUrl);

        Assert.Equal((2, 1), (first!.Count, handler.Requests));
        Assert.Same(first, second);
        Assert.Equal(_certificates.Leaf.Thumbprint, first[0].Thumbprint);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound, "x")]
    [InlineData(HttpStatusCode.OK, "not a certificate")]
    public async Task ChainDownload_FailureIsNullAndRemembered(HttpStatusCode status, string body)
    {
        var handler = new PemHandler(status, body);
        var provider = Provider(handler);

        var first = await provider.GetAsync(AlexaTestCertificates.ChainUrl);
        var second = await provider.GetAsync(AlexaTestCertificates.ChainUrl);

        Assert.Equal(((object?)null, (object?)null, 1), ((object?)first, (object?)second, handler.Requests));
    }

    [Fact]
    public async Task ChainDownload_LargerThanTheCap_IsRefused()
    {
        var handler = new PemHandler(HttpStatusCode.OK, _certificates.Pem() + new string('#', 70 * 1024));

        Assert.Null(await Provider(handler).GetAsync(AlexaTestCertificates.ChainUrl));
    }

    private static HttpAlexaCertificateChainProvider Provider(PemHandler handler) =>
        new(new SingleClientFactory(handler), Options.Create(new AlexaOptions()), TimeProvider.System, NullLogger<HttpAlexaCertificateChainProvider>.Instance);

    private sealed class PemHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public int Requests { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests++;
            Assert.Equal(AlexaTestCertificates.ChainUrl, request.RequestUri);
            return Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.ASCII) });
        }
    }

    private sealed class SingleClientFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false) { MaxResponseContentBufferSize = new AlexaOptions().CertMaxBytes };
    }
}
