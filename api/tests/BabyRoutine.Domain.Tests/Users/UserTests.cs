using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Users;

namespace BabyRoutine.Domain.Tests.Users;

public sealed class UserTests
{
    [Fact]
    public void Create_ValidInput_SetsPropertiesAndNewId()
    {
        var user = User.Create("auth0|abc", "  Ana  ", TestClock.Now);

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
        var exception = Assert.Throws<DomainValidationException>(() => User.Create(subject, "Ana", TestClock.Now));

        Assert.Equal(nameof(User.Subject), exception.Field);
    }

    [Fact]
    public void Create_SubjectTooLong_ThrowsValidation()
    {
        var subject = new string('s', User.SubjectMaxLength + 1);

        Assert.Throws<DomainValidationException>(() => User.Create(subject, "Ana", TestClock.Now));
    }

    [Fact]
    public void Create_NonUtcTimestamp_StoresUtc()
    {
        var local = new DateTimeOffset(2026, 1, 10, 9, 0, 0, TimeSpan.FromHours(-3));

        var user = User.Create("sub", "Ana", local);

        Assert.Equal(TimeSpan.Zero, user.CreatedAt.Offset);
        Assert.Equal(TestClock.Now, user.CreatedAt);
    }

    [Fact]
    public void Rename_Blank_ThrowsValidationAndKeepsName()
    {
        var user = User.Create("sub", "Ana", TestClock.Now);

        Assert.Throws<DomainValidationException>(() => user.Rename(" "));
        Assert.Equal("Ana", user.DisplayName);
    }

    [Fact]
    public void Rename_Valid_ChangesDisplayName()
    {
        var user = User.Create("sub", "Ana", TestClock.Now);

        user.Rename("Ana Maria");

        Assert.Equal("Ana Maria", user.DisplayName);
    }
}
