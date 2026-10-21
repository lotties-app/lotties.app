using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.EventTypes;

public sealed class EventTypeValueObjectTests
{
    [Theory]
    [InlineData("feeding")]
    [InlineData("tummy_time")]
    [InlineData("custom2")]
    public void EventTypeKeyFrom_Valid_KeepsValue(string value)
    {
        Assert.Equal(value, EventTypeKey.From(value).Value);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Feeding")]
    [InlineData("2nd")]
    [InlineData("tummy-time")]
    [InlineData("with space")]
    public void EventTypeKeyFrom_Invalid_ThrowsValidation(string? value)
    {
        Assert.Throws<DomainValidationException>(() => EventTypeKey.From(value));
    }

    [Fact]
    public void EventTypeKeyFrom_TooLong_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => EventTypeKey.From(new string('a', EventTypeKey.MaxLength + 1)));
    }

    [Fact]
    public void HexColorFrom_UpperCase_NormalizesToLowerCase()
    {
        Assert.Equal("#aabbcc", HexColor.From("#AABBCC").Value);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("aabbcc")]
    [InlineData("#abc")]
    [InlineData("#gggggg")]
    [InlineData("#aabbccdd")]
    public void HexColorFrom_Invalid_ThrowsValidation(string? value)
    {
        Assert.Throws<DomainValidationException>(() => HexColor.From(value));
    }
}
