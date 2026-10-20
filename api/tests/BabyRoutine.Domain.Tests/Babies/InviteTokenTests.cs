using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.Babies;

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
    public void From_TooLong_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => InviteToken.From(new string('a', InviteToken.MaxLength + 1)));
    }
}
