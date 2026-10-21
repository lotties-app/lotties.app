using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.EventTypes;

/// <summary><see cref="EventType.EnsureValidPayload"/>: kinds, options, ranges, required fields and hidden fields.</summary>
public sealed class EventPayloadValidationTests
{
    private static readonly DateTimeOffset Ended = new(2026, 1, 10, 8, 30, 0, TimeSpan.Zero);

    private static void Ensure(EventType eventType, string json, DateTimeOffset? endedAt) =>
        eventType.EnsureValidPayload(EventPayload.From(json), endedAt);

    private static DomainValidationException Rejected(EventType eventType, string json, DateTimeOffset? endedAt = null) =>
        Assert.Throws<DomainValidationException>(() => Ensure(eventType, json, endedAt ?? Ended));

    private static EventType Custom(bool hasDuration, params EventFieldDefinition[] fields) =>
        EventType.CreateCustom(Guid.NewGuid(), EventTypeKey.From("custom"), "Custom", "star", HexColor.From("#123456"), hasDuration, fields);

    [Theory]
    [InlineData("""{"method":"bottle","amount_ml":120,"bottle_feeding_type":"formula"}""")]
    [InlineData("""{"method":"breast","side":"both","breast_left_seconds":600,"breast_right_seconds":540}""")]
    [InlineData("""{"method":"solid","food":"Banana"}""")]
    [InlineData("""{"method":"bottle","amount_ml":null,"side":null}""")]
    [InlineData("""{"method":"bottle","amount":120,"extra":{"nested":[1,2]}}""")]
    public void Feeding_ConformingPayload_IsAccepted(string json)
    {
        Ensure(BuiltInEventTypes.Feeding, json, Ended);
    }

    [Theory]
    [InlineData("""{"method":"bottle","side":"left"}""", "side")]
    [InlineData("""{"method":"breast","amount_ml":120}""", "amount_ml")]
    [InlineData("""{"method":"breast","bottle_feeding_type":"formula"}""", "bottle_feeding_type")]
    [InlineData("""{"method":"bottle","breast_left_seconds":60}""", "breast_left_seconds")]
    [InlineData("""{"method":"bottle","food":"Banana"}""", "food")]
    public void Feeding_ValueForHiddenField_IsRejectedOnThatField(string json, string field)
    {
        var exception = Rejected(BuiltInEventTypes.Feeding, json);

        Assert.Equal((field, "validation_failed"), (exception.Field, exception.Code));
    }

    [Fact]
    public void Feeding_HiddenFieldMessage_NamesTheCondition()
    {
        var exception = Rejected(BuiltInEventTypes.Feeding, """{"method":"bottle","side":"left"}""");

        Assert.Equal("'side' applies only when 'method' is breast.", exception.Message);
    }

    [Theory]
    [InlineData("""{"method":"spoon"}""", "method")]
    [InlineData("""{"method":"BOTTLE"}""", "method")]
    [InlineData("""{"method":1}""", "method")]
    [InlineData("""{"method":"bottle","bottle_feeding_type":"FORMULA"}""", "bottle_feeding_type")]
    [InlineData("""{"method":"bottle","amount_ml":-1}""", "amount_ml")]
    [InlineData("""{"method":"bottle","amount_ml":"120"}""", "amount_ml")]
    [InlineData("""{"method":"solid","food":42}""", "food")]
    public void Feeding_WrongKindOptionOrRange_IsRejectedOnThatField(string json, string field)
    {
        Assert.Equal(field, Rejected(BuiltInEventTypes.Feeding, json).Field);
    }

    [Fact]
    public void Feeding_CompleteWithoutRequiredMethod_IsRejected()
    {
        var exception = Rejected(BuiltInEventTypes.Feeding, """{}""");

        Assert.Equal(("method", "'method' is required."), (exception.Field, exception.Message));
    }

    [Fact]
    public void Feeding_RunningWithoutRequiredMethod_IsAccepted()
    {
        Ensure(BuiltInEventTypes.Feeding, """{}""", endedAt: null);
    }

    [Fact]
    public void Feeding_RunningWithHiddenFieldValue_IsStillRejected()
    {
        var exception = Assert.Throws<DomainValidationException>(() => Ensure(BuiltInEventTypes.Feeding, """{"side":"left"}""", endedAt: null));

        Assert.Equal("side", exception.Field);
    }

    [Fact]
    public void InstantType_WithoutEnd_IsTreatedAsComplete()
    {
        Assert.Equal("content", Assert.Throws<DomainValidationException>(() => Ensure(BuiltInEventTypes.Diaper, """{}""", endedAt: null)).Field);
    }

    [Theory]
    [InlineData("""{"intensity":0}""")]
    [InlineData("""{"intensity":5.5}""")]
    [InlineData("""{"intensity":1e400}""")]
    [InlineData("""{"intensity":-1e400}""")]
    public void BellyPain_IntensityOutOfRange_IsRejected(string json)
    {
        Assert.Equal("intensity", Rejected(BuiltInEventTypes.BellyPain, json).Field);
    }

    [Theory]
    [InlineData("""{"intensity":1}""")]
    [InlineData("""{"intensity":5}""")]
    [InlineData("""{"intensity":3.0}""")]
    public void BellyPain_IntensityInRange_IsAccepted(string json)
    {
        Ensure(BuiltInEventTypes.BellyPain, json, Ended);
    }

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"amount_left_ml":40,"amount_right_ml":35.5}""")]
    [InlineData("""{"amount_right_ml":0}""")]
    public void BreastPump_OptionalNonNegativeAmounts_AreAccepted(string json)
    {
        Ensure(BuiltInEventTypes.BreastPump, json, Ended);
    }

    [Fact]
    public void BreastPump_NegativeAmount_IsRejected()
    {
        Assert.Equal("amount_left_ml", Rejected(BuiltInEventTypes.BreastPump, """{"amount_left_ml":-0.5}""").Field);
    }

    [Fact]
    public void Medication_HasNoFields_SoAnyPayloadIsAccepted()
    {
        Ensure(BuiltInEventTypes.Medication, """{"medications":[{"medicationId":"x","name":"y"}]}""", Ended);
    }

    [Fact]
    public void Custom_RequiredBool_MayBeAbsentButMustBeABooleanWhenSent()
    {
        var eventType = Custom(false, EventFieldDefinition.Create("done", "Done", EventFieldKind.Bool, isRequired: true));

        Ensure(eventType, """{}""", Ended);
        Ensure(eventType, """{"done":false}""", Ended);
        Assert.Equal("done", Rejected(eventType, """{"done":"yes"}""").Field);
    }

    [Fact]
    public void Custom_RequiredHiddenField_IsNotRequired()
    {
        var eventType = Custom(
            false,
            EventFieldDefinition.Create("place", "Place", EventFieldKind.Select, options: ["home", "out"]),
            EventFieldDefinition.Create("address", "Address", EventFieldKind.Text, isRequired: true, visibleWhen: FieldVisibilityCondition.Create("place", ["out"])));

        Ensure(eventType, """{"place":"home"}""", Ended);
        Ensure(eventType, """{}""", Ended);
        Assert.Equal("address", Rejected(eventType, """{"place":"out"}""").Field);
    }

    [Fact]
    public void Custom_FieldBehindAHiddenController_IsHiddenToo()
    {
        var eventType = Custom(
            false,
            EventFieldDefinition.Create("method", "Method", EventFieldKind.Select, options: ["bottle", "solid"]),
            EventFieldDefinition.Create("brand", "Brand", EventFieldKind.Select, options: ["a", "b"], visibleWhen: FieldVisibilityCondition.Create("method", ["bottle"])),
            EventFieldDefinition.Create("batch", "Batch", EventFieldKind.Text, visibleWhen: FieldVisibilityCondition.Create("brand", ["b"])));

        Ensure(eventType, """{"method":"bottle","brand":"b","batch":"42"}""", Ended);
        Assert.Equal("brand", Rejected(eventType, """{"method":"solid","brand":"b","batch":"42"}""").Field);
        Assert.Equal("batch", Rejected(eventType, """{"method":"bottle","brand":"a","batch":"42"}""").Field);
    }

    [Fact]
    public void Custom_NumberWithoutBounds_AcceptsAnyStorableNumber()
    {
        var eventType = Custom(false, EventFieldDefinition.Create("count", "Count", EventFieldKind.Number));

        Ensure(eventType, """{"count":-1e300}""", Ended);
    }
}
