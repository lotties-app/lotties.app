using System.Net;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores;
using Microsoft.Extensions.Options;
using Npgsql;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// The pinned connection recipe of docs/design/47a-byo-database-spikes.md (b) against an in-process TLS server on loopback
/// (reached only through the guard's loopback test seam): the connection goes to the pinned address while the certificate
/// is checked against the typed name and a trusted chain. Nothing here leaves the machine.
/// </summary>
public sealed class PinnedStoreTlsTests : IDisposable
{
    private const string TypedName = "db.example.com";

    private static readonly StoreConnectionFields Fields = StoreConnectionFields.Create("lotties", "lotties_app", "not-the-real-one");

    private readonly X509Certificate2 _ca = TestCertificates.CreateCa("Lotties Test CA");
    private readonly X509Certificate2 _otherCa = TestCertificates.CreateCa("Somebody Else CA");

    public void Dispose()
    {
        _ca.Dispose();
        _otherCa.Dispose();
    }

    [Fact]
    public async Task Open_TrustedChainAndMatchingName_GetsThroughTls()
    {
        using var certificate = TestCertificates.CreateServer(_ca, TypedName);
        await using var server = new FakePostgresTlsServer(certificate);
        var endpoint = await PinLoopbackAsync(TypedName, server.Port);
        await using var dataSource = new PinnedStoreDataSourceFactory().Create(endpoint, Fields, Roots(_ca));

        var exception = await Assert.ThrowsAsync<PostgresException>(() => PinnedStoreDataSourceFactory.OpenAsync(dataSource));

        Assert.Equal("28P01", exception.SqlState);
        Assert.Equal(1, server.StartupMessages);
        Assert.Equal([TypedName], server.ServerNames);
    }

    [Fact]
    public async Task Open_CertificateForAnotherName_ThrowsTlsFailed()
    {
        using var certificate = TestCertificates.CreateServer(_ca, "other.example.com");
        await using var server = new FakePostgresTlsServer(certificate);
        var endpoint = await PinLoopbackAsync(TypedName, server.Port);
        await using var dataSource = new PinnedStoreDataSourceFactory().Create(endpoint, Fields, Roots(_ca));

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => PinnedStoreDataSourceFactory.OpenAsync(dataSource));

        Assert.Equal("endpoint_tls_failed", exception.Code);
        Assert.Equal(0, server.StartupMessages);
        Assert.Null(exception.InnerException);
        Assert.DoesNotContain("127.0.0.1", exception.ToString(), StringComparison.Ordinal);
        Assert.DoesNotContain(TypedName, exception.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Open_ChainToAnUntrustedCa_ThrowsTlsFailed()
    {
        using var certificate = TestCertificates.CreateServer(_otherCa, TypedName);
        await using var server = new FakePostgresTlsServer(certificate);
        var endpoint = await PinLoopbackAsync(TypedName, server.Port);
        await using var dataSource = new PinnedStoreDataSourceFactory().Create(endpoint, Fields, Roots(_ca));

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => PinnedStoreDataSourceFactory.OpenAsync(dataSource));

        Assert.Equal("endpoint_tls_failed", exception.Code);
        Assert.Equal(0, server.StartupMessages);
    }

    [Fact]
    public async Task Open_SystemTrustAndAPrivateCa_ThrowsTlsFailed()
    {
        using var certificate = TestCertificates.CreateServer(_ca, TypedName);
        await using var server = new FakePostgresTlsServer(certificate);
        var endpoint = await PinLoopbackAsync(TypedName, server.Port);
        await using var dataSource = new PinnedStoreDataSourceFactory().Create(endpoint, Fields);

        var exception = await Assert.ThrowsAsync<StoreEndpointRejectedException>(() => PinnedStoreDataSourceFactory.OpenAsync(dataSource));

        Assert.Equal("endpoint_tls_failed", exception.Code);
        Assert.Equal(0, server.StartupMessages);
    }

    /// <summary>
    /// Guards the two refusal tests above: with a callback that accepts everything, the same wrong-name and untrusted-chain
    /// servers are reached, so a factory that ever stopped verifying would make those tests fail.
    /// </summary>
    [Theory]
    [InlineData("other.example.com", false)]
    [InlineData(TypedName, true)]
    public async Task Open_CallbackThatAcceptsEverything_WouldReachTheBadServers(string certificateName, bool fromOtherCa)
    {
        using var certificate = TestCertificates.CreateServer(fromOtherCa ? _otherCa : _ca, certificateName);
        await using var server = new FakePostgresTlsServer(certificate);
        var endpoint = await PinLoopbackAsync(TypedName, server.Port);
        await using var dataSource = PinnedStoreDataSourceFactory.Create(endpoint, Fields, Roots(_ca), (_, _, _, _) => true);

        var exception = await Assert.ThrowsAsync<PostgresException>(() => PinnedStoreDataSourceFactory.OpenAsync(dataSource));

        Assert.Equal("28P01", exception.SqlState);
        Assert.Equal(1, server.StartupMessages);
    }

    [Fact]
    public async Task Open_UserCaFromPem_GetsThroughTls()
    {
        using var certificate = TestCertificates.CreateServer(_ca, TypedName);
        await using var server = new FakePostgresTlsServer(certificate);
        var endpoint = await PinLoopbackAsync(TypedName, server.Port);
        var roots = StoreTrustAnchors.FromPem(TestCertificates.ToPem(_ca));
        await using var dataSource = new PinnedStoreDataSourceFactory().Create(endpoint, Fields, roots);

        var exception = await Assert.ThrowsAsync<PostgresException>(() => PinnedStoreDataSourceFactory.OpenAsync(dataSource));

        Assert.Equal("28P01", exception.SqlState);
    }

    [Theory]
    [InlineData(SslPolicyErrors.RemoteCertificateNameMismatch)]
    [InlineData(SslPolicyErrors.RemoteCertificateChainErrors)]
    [InlineData(SslPolicyErrors.RemoteCertificateNotAvailable)]
    [InlineData(SslPolicyErrors.RemoteCertificateNameMismatch | SslPolicyErrors.RemoteCertificateChainErrors)]
    public void AcceptOnlyValidCertificate_AnyPolicyError_Refuses(SslPolicyErrors errors)
    {
        using var certificate = TestCertificates.CreateServer(_ca, TypedName);

        var accepted = PinnedStoreDataSourceFactory.AcceptOnlyValidCertificate(this, certificate, null, errors);

        Assert.False(accepted);
    }

    [Fact]
    public void AcceptOnlyValidCertificate_NoCertificate_Refuses()
    {
        var accepted = PinnedStoreDataSourceFactory.AcceptOnlyValidCertificate(this, null, null, SslPolicyErrors.None);

        Assert.False(accepted);
    }

    [Fact]
    public void ConnectionString_UsesThePinnedAddressAndFixedOptionsOnly()
    {
        var endpoint = new PinnedEndpoint(IPAddress.Parse("1.1.1.1"), StoreHostName.Parse(TypedName), 6543);

        var settings = new NpgsqlConnectionStringBuilder(PinnedStoreDataSourceFactory.ConnectionString(endpoint, StoreConnectionFields.Create("db", "lotties_app.ref", "p@ss!word#1")));

        Assert.Equal("1.1.1.1", settings.Host);
        Assert.Equal(6543, settings.Port);
        Assert.Equal("db", settings.Database);
        Assert.Equal("lotties_app.ref", settings.Username);
        Assert.Equal("p@ss!word#1", settings.Password);
        Assert.Equal(SslMode.Require, settings.SslMode);
        Assert.Equal(GssEncryptionMode.Disable, settings.GssEncryptionMode);
        Assert.Equal(PinnedStoreDataSourceFactory.ApplicationName, settings.ApplicationName);
        Assert.Equal(PinnedStoreDataSourceFactory.MaxPoolSize, settings.MaxPoolSize);
        Assert.Equal(PinnedStoreDataSourceFactory.ConnectTimeoutSeconds, settings.Timeout);
        Assert.Equal(PinnedStoreDataSourceFactory.CommandTimeoutSeconds, settings.CommandTimeout);
        Assert.False(settings.IncludeErrorDetail);
        Assert.False(settings.LogParameters);
        Assert.Null(settings.Options);
        Assert.Null(settings.Passfile);
        Assert.Null(settings.SslCertificate);
        Assert.Null(settings.RootCertificate);
        Assert.DoesNotContain(TypedName, settings.ConnectionString, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("pw;Options=-c statement_timeout=0")]
    [InlineData("a=b;Passfile=/etc/passwd;Include Error Detail=true")]
    [InlineData("it's \"quoted\"; Host=10.0.0.1")]
    [InlineData(" pw with spaces= ")]
    public void ConnectionString_PasswordWithSeparatorsAndQuotes_StaysOneValueAndAddsNoOption(string password)
    {
        var endpoint = new PinnedEndpoint(IPAddress.Parse("1.1.1.1"), StoreHostName.Parse(TypedName), 5432);

        var settings = new NpgsqlConnectionStringBuilder(PinnedStoreDataSourceFactory.ConnectionString(endpoint, StoreConnectionFields.Create("db", "lotties_app", password)));

        Assert.Equal(password, settings.Password);
        Assert.Equal("1.1.1.1", settings.Host);
        Assert.Null(settings.Options);
        Assert.Null(settings.Passfile);
        Assert.False(settings.IncludeErrorDetail);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not a certificate")]
    [InlineData("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----")]
    public void FromPem_Unreadable_ThrowsInvalidCa(string pem)
    {
        var exception = Assert.Throws<StoreEndpointRejectedException>(() => StoreTrustAnchors.FromPem(pem));

        Assert.Equal("endpoint_invalid_ca", exception.Code);
    }

    [Fact]
    public void FromPem_TooLarge_ThrowsInvalidCa()
    {
        var pem = string.Concat(Enumerable.Repeat(TestCertificates.ToPem(_ca) + "\n", 40));

        var exception = Assert.Throws<StoreEndpointRejectedException>(() => StoreTrustAnchors.FromPem(pem));

        Assert.Equal("endpoint_invalid_ca", exception.Code);
    }

    private static X509Certificate2Collection Roots(X509Certificate2 ca) => [X509CertificateLoader.LoadCertificate(ca.RawData)];

    private static Task<PinnedEndpoint> PinLoopbackAsync(string typedName, int port)
    {
        var resolver = new FakeHostResolver().Answer("127.0.0.1");
        var options = new StoreEndpointGuardOptions { AllowLoopbackForTests = true, ExtraAllowedPorts = [port] };
        return new StoreEndpointGuard(resolver, Options.Create(options)).PinAsync(typedName, port);
    }
}
