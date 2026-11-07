using System.Net;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

public sealed class StoreHostNameTests
{
    public static TheoryData<string?> InvalidHosts => new()
    {
        null,
        "",
        "2130706433",
        "0x7f000001",
        "0177.0.0.1",
        "0x7f.0.0.1",
        "127.1",
        "010.0.0.1",
        "1.2.3.256",
        "1.2.3.4.5",
        "foo.123",
        "postgres://db.example.com",
        "db.example.com:5432",
        "db.example.com/postgres",
        "user@db.example.com",
        "user:pass@db.example.com",
        " db.example.com",
        "db.example.com ",
        "db.exa mple.com",
        "db.example.com\n",
        "db.example.com\0",
        "db.example.com;Host=10.0.0.1",
        "db.example.com'",
        "db.example.com\"",
        "db=example.com",
        "db\\example.com",
        "db.example.com.",
        "localhost",
        "db.localhost",
        "printer.local",
        "metadata.google.internal",
        "router.home.arpa",
        "1.0.0.127.in-addr.arpa",
        "db.test",
        "db.lan",
        "db",
        "-db.example.com",
        "db-.example.com",
        "db..example.com",
        "[::1]",
        "fe80::1%eth0",
        "dbé.example.com",
        "db_1.example.com",
        new string('a', 64) + ".example.com",
        string.Join('.', Enumerable.Repeat(new string('a', 50), 5)) + ".com",
    };

    [Theory]
    [MemberData(nameof(InvalidHosts))]
    public void Parse_InvalidHost_ThrowsInvalidHost(string? typed)
    {
        var exception = Assert.Throws<StoreEndpointRejectedException>(() => StoreHostName.Parse(typed));

        Assert.Equal("endpoint_invalid_host", exception.Code);
    }

    [Theory]
    [InlineData("db.example.com", "db.example.com")]
    [InlineData("DB.Example.COM", "db.example.com")]
    [InlineData("aws-0-sa-east-1.pooler.supabase.com", "aws-0-sa-east-1.pooler.supabase.com")]
    [InlineData("ep-cool-name-123456-pooler.us-east-2.aws.neon.tech", "ep-cool-name-123456-pooler.us-east-2.aws.neon.tech")]
    [InlineData("xn--bcher-kva.example.com", "xn--bcher-kva.example.com")]
    [InlineData("db.example.com.br", "db.example.com.br")]
    public void Parse_DnsName_KeepsTheLowerCasedName(string typed, string expected)
    {
        var host = StoreHostName.Parse(typed);

        Assert.Equal(expected, host.Value);
        Assert.False(host.IsAddressLiteral);
    }

    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("0.0.0.0")]
    [InlineData("127.0.0.1")]
    [InlineData("2606:4700:4700::1111")]
    [InlineData("::ffff:10.0.0.1")]
    public void Parse_CanonicalLiteral_KeepsTheAddress(string typed)
    {
        var host = StoreHostName.Parse(typed);

        Assert.True(host.IsAddressLiteral);
        Assert.Equal(IPAddress.Parse(typed), host.Address);
    }
}
