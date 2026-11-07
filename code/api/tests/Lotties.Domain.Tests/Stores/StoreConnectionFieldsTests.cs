using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

public sealed class StoreConnectionFieldsTests
{
    [Theory]
    [InlineData("database", "", "lotties_app", "secret")]
    [InlineData("database", "postgres;Options=-c", "lotties_app", "secret")]
    [InlineData("database", "post gres", "lotties_app", "secret")]
    [InlineData("username", "postgres", "lotties_app\nInclude Error Detail=true", "secret")]
    [InlineData("username", "postgres", "lotties'app", "secret")]
    [InlineData("username", "postgres", "lotties\"app", "secret")]
    [InlineData("username", "postgres", null, "secret")]
    [InlineData("password", "postgres", "lotties_app", "pa=ss")]
    [InlineData("password", "postgres", "lotties_app", "pa;Passfile=/etc/passwd")]
    [InlineData("password", "postgres", "lotties_app", "pa\\ss")]
    [InlineData("password", "postgres", "lotties_app", "pa\0ss")]
    [InlineData("password", "postgres", "lotties_app", "senhaçã")]
    public void Create_ForbiddenValue_ThrowsInvalidFieldNamingOnlyTheField(string field, string? database, string? username, string? password)
    {
        var exception = Assert.Throws<StoreEndpointRejectedException>(() => StoreConnectionFields.Create(database, username, password));

        Assert.Equal("endpoint_invalid_field", exception.Code);
        Assert.Equal(field, exception.Details["field"]);
        Assert.DoesNotContain(password ?? "\u0001", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Create_TooLongName_ThrowsInvalidField()
    {
        var exception = Assert.Throws<StoreEndpointRejectedException>(() => StoreConnectionFields.Create(new string('d', 64), "u", "p"));

        Assert.Equal("endpoint_invalid_field", exception.Code);
    }

    [Fact]
    public void Create_SupabasePoolerUser_KeepsTheValues()
    {
        var fields = StoreConnectionFields.Create("postgres", "lotties_app.abcdefghijklmnopqrst", "Xk9-p_Q.r!t@z#");

        Assert.Equal("lotties_app.abcdefghijklmnopqrst", fields.Username);
        Assert.Equal("Xk9-p_Q.r!t@z#", fields.Password);
    }

    [Fact]
    public void ToString_NeverPrintsAValue()
    {
        var text = StoreConnectionFields.Create("lottiesdb", "lotties_app", "S3cretValue").ToString();

        Assert.DoesNotContain("S3cretValue", text, StringComparison.Ordinal);
        Assert.DoesNotContain("lotties_app", text, StringComparison.Ordinal);
    }
}
