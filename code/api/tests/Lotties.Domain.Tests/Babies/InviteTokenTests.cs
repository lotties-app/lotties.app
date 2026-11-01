using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Babies;

public sealed class InviteTokenTests
{
    [Fact]
    public void Generate_ProducesUrlSafeTokenThatRoundTrips()
    {
        var token = InviteToken.Generate();

        Assert.Matches("^[A-Za-z0-9_-]{43}$", token.Value);
        Assert.Equal(token, InviteToken.From(token.Value));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("short")]
    [InlineData("contains spaces and is long enough")]
    [InlineData("has+plus/slash=padding0000")]
    public void From_Malformed_ThrowsValidation(string? value)
    {
        Assert.Throws<DomainValidationException>(() => InviteToken.From(value));
    }

    [Fact]
    public void Hash_Token_IsDeterministicUrlSafeAndDifferentFromTheToken()
    {
        var token = InviteToken.Generate();

        var hash = token.Hash();

        Assert.Matches("^[A-Za-z0-9_-]{43}$", hash.Value);
        Assert.Equal(hash, token.Hash());
        Assert.NotEqual(token, hash);
        Assert.NotEqual(hash, InviteToken.Generate().Hash());
    }

    [Fact]
    public void TryFrom_WellFormed_ReturnsTokenWithoutThrowing()
    {
        var generated = InviteToken.Generate();

        Assert.True(InviteToken.TryFrom(generated.Value, out var parsed));
        Assert.Equal(generated, parsed);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("short")]
    [InlineData("has+plus/slash=padding0000")]
    public void TryFrom_Malformed_ReturnsFalse(string? value)
    {
        Assert.False(InviteToken.TryFrom(value, out _));
    }

    [Fact]
    public void From_TooLong_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => InviteToken.From(new string('a', InviteToken.MaxLength + 1)));
    }
}
