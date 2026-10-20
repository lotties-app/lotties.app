using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Users;

namespace BabyRoutine.Domain.Tests.Users;

public sealed class ExternalIdentityTests
{
    [Fact]
    public void DisplayName_NamePresent_UsesTrimmedName()
    {
        var identity = new ExternalIdentity("sub", "  Ana  ", "ana@example.test");

        Assert.Equal("Ana", identity.DisplayName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public void DisplayName_NoName_UsesEmail(string? name)
    {
        var identity = new ExternalIdentity("sub", name, "ana@example.test");

        Assert.Equal("ana@example.test", identity.DisplayName);
    }

    [Fact]
    public void DisplayName_NoNameNorEmail_UsesFallback()
    {
        var identity = new ExternalIdentity("sub", null, " ");

        Assert.Equal(ExternalIdentity.FallbackDisplayName, identity.DisplayName);
    }

    [Fact]
    public void DisplayName_TooLong_IsCutToUserLimit()
    {
        var identity = new ExternalIdentity("sub", new string('a', User.DisplayNameMaxLength + 20), null);

        Assert.Equal(User.DisplayNameMaxLength, identity.DisplayName.Length);
    }

    [Fact]
    public void Register_ValidIdentity_CreatesUserWithSubjectAndDisplayName()
    {
        var user = User.Register(new ExternalIdentity("auth0|abc", null, "ana@example.test"), TestClock.Now);

        Assert.Equal("auth0|abc", user.Subject);
        Assert.Equal("ana@example.test", user.DisplayName);
        Assert.Equal(TestClock.Now, user.CreatedAt);
    }

    [Fact]
    public void Register_BlankSubject_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => User.Register(new ExternalIdentity(" ", "Ana", null), TestClock.Now));
    }
}
