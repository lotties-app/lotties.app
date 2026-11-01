using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Common;

/// <summary>Whole-string patterns end with <c>\z</c>: .NET <c>$</c> would also accept a trailing newline.</summary>
public sealed class WholeStringPatternTests
{
    [Theory]
    [InlineData("#aabbcc\n")]
    [InlineData("#AABBCC\r\n")]
    public void HexColorFrom_TrailingNewline_ThrowsValidation(string value)
    {
        Assert.Throws<DomainValidationException>(() => HexColor.From(value));
    }

    [Theory]
    [InlineData("pumping\n")]
    [InlineData("tummy_time\r\n")]
    public void EventTypeKeyFrom_TrailingNewline_ThrowsValidation(string value)
    {
        Assert.Throws<DomainValidationException>(() => EventTypeKey.From(value));
    }

    [Fact]
    public void FieldKey_TrailingNewline_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create("side\n", "Side", EventFieldKind.Text));
    }

    [Fact]
    public void InviteTokenFrom_TrailingNewline_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(() => InviteToken.From(InviteToken.Generate().Value + "\n"));
    }
}
