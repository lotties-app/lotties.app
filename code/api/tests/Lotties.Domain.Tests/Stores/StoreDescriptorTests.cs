using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

public sealed class StoreDescriptorTests
{
    private const string AppPassword = "app pass-WORD 1";
    private const string MigratorPassword = "migrator-pass-2";

    [Fact]
    public void Create_ValidFields_KeepsTrimmedTokensAndExactPasswords()
    {
        var descriptor = StoreDescriptor.Create(
            "  Example host ",
            StoreEndpoint.Create(" db.example.test ", 6543, " lotties ", " lotties_app.projectref ", " " + AppPassword),
            StoreMigratorEndpoint.Create("direct.example.test", 5432, "lotties_migrator", MigratorPassword),
            StoreTlsPolicy.Create(StoreSslMode.VerifyFull, null));

        Assert.Equal("Example host", descriptor.ProviderLabel);
        Assert.Equal("db.example.test", descriptor.App.Host);
        Assert.Equal(6543, descriptor.App.Port);
        Assert.Equal("lotties", descriptor.App.Database);
        Assert.Equal("lotties_app.projectref", descriptor.App.Username);
        Assert.Equal(" " + AppPassword, descriptor.App.Password.Reveal());
        Assert.Equal("direct.example.test", descriptor.Migrator.Host);
        Assert.Equal(MigratorPassword, descriptor.Migrator.Password.Reveal());
        Assert.Equal(StoreSslMode.VerifyFull, descriptor.Tls.SslMode);
        Assert.Null(descriptor.Tls.CaCertificatePem);
    }

    [Fact]
    public void Create_SameValues_AreEqual()
    {
        Assert.Equal(Valid(), Valid());
    }

    [Theory]
    [InlineData(null, "db", "user", "pw", "app.host")]
    [InlineData("   ", "db", "user", "pw", "app.host")]
    [InlineData("h", null, "user", "pw", "app.database")]
    [InlineData("h", "db", "", "pw", "app.username")]
    [InlineData("h", "db", "user", "", "app.password")]
    [InlineData("h", "db", "user", null, "app.password")]
    public void StoreEndpointCreate_MissingField_ThrowsNamingTheField(string? host, string? database, string? username, string? password, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => StoreEndpoint.Create(host, 5432, database, username, password));

        Assert.Equal(field, exception.Field);
    }

    [Theory]
    [InlineData("db.example.test;Include Error Detail=true", "app.host")]
    [InlineData("db.example\n.test", "app.host")]
    [InlineData("db example.test", "app.host")]
    [InlineData("db\0.example.test", "app.host")]
    public void StoreEndpointCreate_HostWithForbiddenCharacter_Throws(string host, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => StoreEndpoint.Create(host, 5432, "db", "user", "pw"));

        Assert.Equal(field, exception.Field);
    }

    [Theory]
    [InlineData("pw;Options=-c x")]
    [InlineData("pw=1")]
    [InlineData("pw\r\n")]
    [InlineData("pw\0")]
    public void StoreEndpointCreate_PasswordWithForbiddenCharacter_ThrowsWithoutEchoingIt(string password)
    {
        var exception = Assert.Throws<DomainValidationException>(() => StoreEndpoint.Create("h", 5432, "db", "user", password));

        Assert.Equal("app.password", exception.Field);
        Assert.DoesNotContain(password.TrimEnd('\r', '\n', '\0'), exception.Message);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(65536)]
    public void Create_PortOutOfRange_Throws(int port)
    {
        Assert.Equal("app.port", Assert.Throws<DomainValidationException>(() => StoreEndpoint.Create("h", port, "db", "u", "p")).Field);
        Assert.Equal("migrator.port", Assert.Throws<DomainValidationException>(() => StoreMigratorEndpoint.Create("h", port, "u", "p")).Field);
    }

    [Fact]
    public void Create_FieldsOverTheirLimits_Throw()
    {
        Assert.Equal("app.host", Assert.Throws<DomainValidationException>(() => StoreEndpoint.Create(new string('h', StoreEndpoint.MaxHostLength + 1), 5432, "db", "u", "p")).Field);
        Assert.Equal("app.database", Assert.Throws<DomainValidationException>(() => StoreEndpoint.Create("h", 5432, new string('d', StoreEndpoint.MaxDatabaseLength + 1), "u", "p")).Field);
        Assert.Equal("app.username", Assert.Throws<DomainValidationException>(() => StoreEndpoint.Create("h", 5432, "db", new string('u', StoreEndpoint.MaxUsernameLength + 1), "p")).Field);
        Assert.Equal("app.password", Assert.Throws<DomainValidationException>(() => StoreEndpoint.Create("h", 5432, "db", "u", new string('p', StoreEndpoint.MaxPasswordLength + 1))).Field);
        Assert.Equal("providerLabel", Assert.Throws<DomainValidationException>(() => StoreDescriptor.Create(new string('l', StoreDescriptor.MaxProviderLabelLength + 1), ValidApp(), ValidMigrator(), NoCa())).Field);
    }

    [Theory]
    [InlineData(null, "u", "p", "migrator.host")]
    [InlineData("h", " ", "p", "migrator.username")]
    [InlineData("h", "u", "", "migrator.password")]
    [InlineData("h;x=y", "u", "p", "migrator.host")]
    public void StoreMigratorEndpointCreate_InvalidField_ThrowsNamingTheField(string? host, string? username, string? password, string field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => StoreMigratorEndpoint.Create(host, 5432, username, password));

        Assert.Equal(field, exception.Field);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Line\nbreak")]
    public void StoreDescriptorCreate_InvalidProviderLabel_Throws(string? label)
    {
        Assert.Equal("providerLabel", Assert.Throws<DomainValidationException>(() => StoreDescriptor.Create(label, ValidApp(), ValidMigrator(), NoCa())).Field);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  \n ")]
    public void StoreTlsPolicyCreate_NoCa_TrustsSystemRootsOnly(string? pem)
    {
        Assert.Null(StoreTlsPolicy.Create(StoreSslMode.VerifyFull, pem).CaCertificatePem);
    }

    [Fact]
    public void StoreTlsPolicyCreate_CertificateChain_IsKept()
    {
        var chain = CertificatePem("CN=root") + "\n" + CertificatePem("CN=intermediate") + "\n";

        var policy = StoreTlsPolicy.Create(StoreSslMode.VerifyFull, chain);

        Assert.Equal(chain.Trim(), policy.CaCertificatePem);
    }

    [Fact]
    public void StoreTlsPolicyCreate_PrivateKeyBlock_Throws()
    {
        using var key = RSA.Create(2048);
        var pem = CertificatePem("CN=root") + "\n" + key.ExportPkcs8PrivateKeyPem();

        Assert.Equal("tls.caCertificatePem", Assert.Throws<DomainValidationException>(() => StoreTlsPolicy.Create(StoreSslMode.VerifyFull, pem)).Field);
    }

    [Theory]
    [InlineData("not a certificate")]
    [InlineData("-----BEGIN CERTIFICATE-----\n!!!!\n-----END CERTIFICATE-----")]
    public void StoreTlsPolicyCreate_NotPem_Throws(string pem)
    {
        Assert.Equal("tls.caCertificatePem", Assert.Throws<DomainValidationException>(() => StoreTlsPolicy.Create(StoreSslMode.VerifyFull, pem)).Field);
    }

    [Fact]
    public void StoreTlsPolicyCreate_TextAroundTheCertificate_Throws()
    {
        var pem = "sslrootcert=/etc/passwd\n" + CertificatePem("CN=root");

        Assert.Throws<DomainValidationException>(() => StoreTlsPolicy.Create(StoreSslMode.VerifyFull, pem));
        Assert.Throws<DomainValidationException>(() => StoreTlsPolicy.Create(StoreSslMode.VerifyFull, CertificatePem("CN=root") + "\ntrailing"));
    }

    [Fact]
    public void StoreTlsPolicyCreate_TooLong_Throws()
    {
        var pem = string.Join("\n", Enumerable.Repeat(CertificatePem("CN=root"), 100));

        Assert.True(pem.Length > StoreTlsPolicy.MaxCaCertificatePemLength);
        Assert.Throws<DomainValidationException>(() => StoreTlsPolicy.Create(StoreSslMode.VerifyFull, pem));
    }

    [Fact]
    public void StoreTlsPolicyCreate_UndefinedMode_Throws()
    {
        Assert.Equal("tls.sslMode", Assert.Throws<DomainValidationException>(() => StoreTlsPolicy.Create((StoreSslMode)0, null)).Field);
    }

    [Fact]
    public void ToString_NeverPrintsAField()
    {
        var descriptor = StoreDescriptor.Create("Example", ValidApp(), ValidMigrator(), StoreTlsPolicy.Create(StoreSslMode.VerifyFull, CertificatePem("CN=root")));

        var printed = string.Join("|", descriptor.ToString(), $"{descriptor.App}", $"{descriptor.Migrator}", $"{descriptor.App.Password}", $"{descriptor.Tls}");

        Assert.DoesNotContain(AppPassword, printed);
        Assert.DoesNotContain(MigratorPassword, printed);
        Assert.DoesNotContain("db.example.test", printed);
        Assert.DoesNotContain("lotties_app", printed);
        Assert.DoesNotContain("lotties_migrator", printed);
        Assert.DoesNotContain("BEGIN CERTIFICATE", printed);
        Assert.Contains(StoreSecret.Redacted, printed);
    }

    [Fact]
    public void JsonSerialize_Descriptor_NeverWritesAPassword()
    {
        var json = JsonSerializer.Serialize(Valid());

        Assert.DoesNotContain(AppPassword, json);
        Assert.DoesNotContain(MigratorPassword, json);
    }

    [Fact]
    public void SealedDescriptorFromBytes_CopiesAndComparesByContent()
    {
        var bytes = new byte[] { 1, 2, 3 };

        var sealedDescriptor = SealedDescriptor.FromBytes(bytes);
        bytes[0] = 9;

        Assert.Equal(new byte[] { 1, 2, 3 }, sealedDescriptor.ToArray());
        Assert.Equal(SealedDescriptor.FromBytes([1, 2, 3]), sealedDescriptor);
        Assert.Equal(SealedDescriptor.FromBytes([1, 2, 3]).GetHashCode(), sealedDescriptor.GetHashCode());
        Assert.Equal("SealedDescriptor { Length = 3 }", sealedDescriptor.ToString());
    }

    [Fact]
    public void SealedDescriptorFromBytes_EmptyOrTooLong_Throws()
    {
        Assert.Throws<ArgumentException>(() => SealedDescriptor.FromBytes([]));
        Assert.Throws<ArgumentException>(() => SealedDescriptor.FromBytes(new byte[SealedDescriptor.MaxLength + 1]));
    }

    private static StoreDescriptor Valid() => StoreDescriptor.Create("Example", ValidApp(), ValidMigrator(), NoCa());

    private static StoreEndpoint ValidApp() => StoreEndpoint.Create("db.example.test", 5432, "lotties", "lotties_app", AppPassword);

    private static StoreMigratorEndpoint ValidMigrator() => StoreMigratorEndpoint.Create("direct.example.test", 5432, "lotties_migrator", MigratorPassword);

    private static StoreTlsPolicy NoCa() => StoreTlsPolicy.Create(StoreSslMode.VerifyFull, null);

    private static string CertificatePem(string subject)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest(subject, key, HashAlgorithmName.SHA256);
        using var certificate = request.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddDays(30));
        return certificate.ExportCertificatePem();
    }
}
