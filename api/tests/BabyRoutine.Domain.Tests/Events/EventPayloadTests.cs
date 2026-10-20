using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.Events;

public sealed class EventPayloadTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void From_Blank_ReturnsEmptyObject(string? json)
    {
        Assert.Equal("{}", EventPayload.From(json).Value);
    }

    [Fact]
    public void From_JsonObject_KeepsText()
    {
        const string json = """{"method":"bottle","amount":120}""";

        Assert.Equal(json, EventPayload.From(json).Value);
    }

    [Theory]
    [InlineData("[1,2]")]
    [InlineData("42")]
    [InlineData("\"text\"")]
    [InlineData("{not json")]
    public void From_NotAJsonObject_ThrowsValidation(string json)
    {
        Assert.Throws<DomainValidationException>(() => EventPayload.From(json));
    }

    [Fact]
    public void From_TooLarge_ThrowsValidation()
    {
        var json = $$"""{"notes":"{{new string('a', EventPayload.MaxLength)}}"}""";

        Assert.Throws<DomainValidationException>(() => EventPayload.From(json));
    }

    [Fact]
    public void Default_ValueIsEmptyObject()
    {
        Assert.Equal("{}", default(EventPayload).Value);
    }
}
