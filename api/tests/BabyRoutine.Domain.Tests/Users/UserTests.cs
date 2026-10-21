using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Users;

namespace BabyRoutine.Domain.Tests.Users;

public sealed class UserTests
{
    [Fact]
    public void Create_ValidInput_SetsPropertiesAndNewId()
    {
        var user = User.Create(User.UnknownIssuer, "auth0|abc", "  Ana  ", TestClock.Now);

        Assert.NotEqual(Guid.Empty, user.Id);
        Assert.Equal("auth0|abc", user.Subject);
        Assert.Equal("Ana", user.DisplayName);
        Assert.Equal(TestClock.Now, user.CreatedAt);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_BlankSubject_ThrowsValidation(string subject)
    {
        var exception = Assert.Throws<DomainValidationException>(() => User.Create(User.UnknownIssuer, subject, "Ana", TestClock.Now));

        Assert.Equal(nameof(User.Subject), exception.Field);
    }

    [Fact]
    public void Create_SubjectTooLong_ThrowsValidation()
    {
        var subject = new string('s', User.SubjectMaxLength + 1);

        Assert.Throws<DomainValidationException>(() => User.Create(User.UnknownIssuer, subject, "Ana", TestClock.Now));
    }

    [Fact]
    public void Create_NonUtcTimestamp_StoresUtc()
    {
        var local = new DateTimeOffset(2026, 1, 10, 9, 0, 0, TimeSpan.FromHours(-3));

        var user = User.Create(User.UnknownIssuer, "sub", "Ana", local);

        Assert.Equal(TimeSpan.Zero, user.CreatedAt.Offset);
        Assert.Equal(TestClock.Now, user.CreatedAt);
    }

    [Fact]
    public void Rename_Blank_ThrowsValidationAndKeepsName()
    {
        var user = User.Create(User.UnknownIssuer, "sub", "Ana", TestClock.Now);

        Assert.Throws<DomainValidationException>(() => user.Rename(" "));
        Assert.Equal("Ana", user.DisplayName);
    }

    [Fact]
    public void Create_IssuerTooLong_ThrowsValidation()
    {
        var exception = Assert.Throws<DomainValidationException>(() => User.Create(new string('i', User.IssuerMaxLength + 1), "sub", "Ana", TestClock.Now));

        Assert.Equal(nameof(User.Issuer), exception.Field);
    }

    [Fact]
    public void ClaimIssuer_UnknownIssuer_RecordsIt()
    {
        var user = User.Create(User.UnknownIssuer, "sub", "Ana", TestClock.Now);

        user.ClaimIssuer("https://issuer.example.test/");

        Assert.Equal("https://issuer.example.test/", user.Issuer);
        Assert.False(user.HasUnknownIssuer);
    }

    [Fact]
    public void ClaimIssuer_KnownIssuer_ThrowsAndKeepsIt()
    {
        var user = User.Create("https://a.example.test/", "sub", "Ana", TestClock.Now);

        Assert.Throws<DomainValidationException>(() => user.ClaimIssuer("https://b.example.test/"));
        Assert.Equal("https://a.example.test/", user.Issuer);
    }

    [Fact]
    public void Rename_Valid_ChangesDisplayName()
    {
        var user = User.Create(User.UnknownIssuer, "sub", "Ana", TestClock.Now);

        user.Rename("Ana Maria");

        Assert.Equal("Ana Maria", user.DisplayName);
    }
}
