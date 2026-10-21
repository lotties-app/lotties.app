using Lotties.Domain.Exceptions;
using Lotties.Domain.Users;

namespace Lotties.Domain.Tests.Users;

public sealed class ExternalIdentityTests
{
    private const string Issuer = "https://issuer.example.test/";

    [Fact]
    public void DisplayName_NamePresent_UsesTrimmedName()
    {
        var identity = new ExternalIdentity(Issuer, "sub", "  Ana  ", "ana_p", "ana_n");

        Assert.Equal("Ana", identity.DisplayName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public void DisplayName_NoName_UsesPreferredUsername(string? name)
    {
        var identity = new ExternalIdentity(Issuer, "sub", name, " ana.souza ", "ana_n");

        Assert.Equal("ana.souza", identity.DisplayName);
    }

    [Fact]
    public void DisplayName_PreferredUsernameIsAnEmail_UsesNickname()
    {
        var identity = new ExternalIdentity(Issuer, "sub", null, "ana@example.test", "ana");

        Assert.Equal("ana", identity.DisplayName);
    }

    [Fact]
    public void DisplayName_NameIsAnEmail_IsNeverShown()
    {
        var identity = new ExternalIdentity(Issuer, "sub", "ana@example.test", null, null);

        Assert.Equal(ExternalIdentity.FallbackDisplayName, identity.DisplayName);
    }

    [Fact]
    public void DisplayName_NoProfileClaims_UsesParent()
    {
        var identity = new ExternalIdentity(Issuer, "sub", null, " ", null);

        Assert.Equal("Parent", identity.DisplayName);
    }

    [Fact]
    public void DisplayName_TooLong_IsCutToUserLimit()
    {
        var identity = new ExternalIdentity(Issuer, "sub", new string('a', User.DisplayNameMaxLength + 20));

        Assert.Equal(User.DisplayNameMaxLength, identity.DisplayName.Length);
    }

    [Fact]
    public void Register_ValidIdentity_CreatesUserWithIssuerSubjectAndDisplayName()
    {
        var user = User.Register(new ExternalIdentity(Issuer, "auth0|abc", null, null, "ana"), TestClock.Now);

        Assert.Equal((Issuer, "auth0|abc"), (user.Issuer, user.Subject));
        Assert.Equal("ana", user.DisplayName);
        Assert.Equal(TestClock.Now, user.CreatedAt);
    }

    [Fact]
    public void Register_BlankSubject_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => User.Register(new ExternalIdentity(Issuer, " ", "Ana"), TestClock.Now));
    }
}
