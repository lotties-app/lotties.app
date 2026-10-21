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

    [Theory]
    [InlineData("""{"a":1,"b":"x"}""", """{ "b" : "x", "a" : 1 }""")]
    [InlineData("""{"amount":120}""", """{"amount":120.0}""")]
    [InlineData("""{"list":[1,{"k":true}],"n":null}""", """{"n":null,"list":[1,{"k":true}]}""")]
    [InlineData("""{"a":1,"a":2}""", """{"a":2}""")]
    [InlineData("{}", "")]
    public void IsEquivalentTo_SameJsonValue_ReturnsTrue(string left, string right)
    {
        Assert.True(EventPayload.From(left).IsEquivalentTo(EventPayload.From(right)));
    }

    [Theory]
    [InlineData("""{"a":1}""", """{"a":2}""")]
    [InlineData("""{"a":1}""", """{"a":1,"b":1}""")]
    [InlineData("""{"a":[1,2]}""", """{"a":[2,1]}""")]
    [InlineData("""{"a":"1"}""", """{"a":1}""")]
    [InlineData("""{"a":true}""", """{"a":false}""")]
    [InlineData("""{"a":"X"}""", """{"a":"x"}""")]
    public void IsEquivalentTo_DifferentJsonValue_ReturnsFalse(string left, string right)
    {
        Assert.False(EventPayload.From(left).IsEquivalentTo(EventPayload.From(right)));
    }

    [Theory]
    [InlineData("""{"kind":"nap","mood":"calm"}""", "nap")]
    [InlineData("""{"kind":1}""", null)]
    [InlineData("""{"other":"nap"}""", null)]
    [InlineData("{}", null)]
    public void GetString_ReturnsTopLevelStringMemberOrNull(string json, string? expected)
    {
        Assert.Equal(expected, EventPayload.From(json).GetString("kind"));
    }
}
