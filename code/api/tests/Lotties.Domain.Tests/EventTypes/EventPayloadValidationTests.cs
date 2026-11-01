using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.EventTypes;

/// <summary><see cref="EventType.EnsureValidPayload"/>: kinds, options, ranges, required fields and hidden fields.</summary>
public sealed class EventPayloadValidationTests
{
    private static readonly DateTimeOffset Started = new(2026, 1, 10, 8, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Ended = new(2026, 1, 10, 8, 30, 0, TimeSpan.Zero);

    private static void Ensure(EventType eventType, string json, DateTimeOffset? endedAt) =>
        eventType.EnsureValidPayload(EventPayload.From(json), Started, endedAt);

    private static DomainValidationException Rejected(EventType eventType, string json, DateTimeOffset? endedAt = null) =>
        Assert.Throws<DomainValidationException>(() => Ensure(eventType, json, endedAt ?? Ended));

    private static EventType Custom(bool hasDuration, params EventFieldDefinition[] fields) =>
        EventType.CreateCustom(Guid.NewGuid(), EventTypeKey.From("custom"), "Custom", "star", HexColor.From("#123456"), hasDuration, fields);

    [Theory]
    [InlineData("""{"method":"bottle","amount_ml":120,"bottle_feeding_type":"formula"}""")]
    [InlineData("""{"method":"breast","side":"both","breast_left_seconds":600,"breast_right_seconds":540}""")]
    [InlineData("""{"method":"bottle","amount_ml":120,"amount_drunk_ml":80,"bottle_feeding_type":"formula"}""")]
    [InlineData("""{"method":"breast","ended_by":"sleep"}""")]
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
    [InlineData("""{"method":"breast","amount_drunk_ml":60}""", "amount_drunk_ml")]
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
    [InlineData("""{"method":"bottle","amount_drunk_ml":-1}""", "amount_drunk_ml")]
    [InlineData("""{"method":"bottle","ended_by":"timer"}""", "ended_by")]
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

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"tool":"bulb","saline":true}""")]
    [InlineData("""{"tool":"electric"}""")]
    [InlineData("""{"tool":"mouth","saline":false}""")]
    [InlineData("""{"saline":true}""")]
    public void NasalSuction_OptionalToolAndSaline_AreAccepted(string json)
    {
        Ensure(BuiltInEventTypes.NasalSuction, json, Ended);
    }

    [Theory]
    [InlineData("""{"tool":"syringe"}""", "tool")]
    [InlineData("""{"tool":"BULB"}""", "tool")]
    [InlineData("""{"saline":"yes"}""", "saline")]
    [InlineData("""{"saline":1}""", "saline")]
    public void NasalSuction_UnknownToolOrNonBooleanSaline_IsRejected(string json, string field)
    {
        Assert.Equal(field, Rejected(BuiltInEventTypes.NasalSuction, json).Field);
    }

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"reason":"gas","helped":"yes"}""")]
    [InlineData("""{"reason":"constipation"}""")]
    [InlineData("""{"reason":"colic","helped":"a_little"}""")]
    [InlineData("""{"reason":"other","helped":"no","pause_count":1,"paused_seconds":30}""")]
    public void BellyMassage_OptionalReasonAndHelped_AreAcceptedRunningOrEnded(string json)
    {
        Ensure(BuiltInEventTypes.BellyMassage, json, Ended);
        Ensure(BuiltInEventTypes.BellyMassage, json, null);
    }

    [Theory]
    [InlineData("""{"reason":"pain"}""", "reason")]
    [InlineData("""{"reason":"GAS"}""", "reason")]
    [InlineData("""{"helped":"maybe"}""", "helped")]
    [InlineData("""{"helped":true}""", "helped")]
    public void BellyMassage_UnknownReasonOrHelped_IsRejected(string json, string field)
    {
        Assert.Equal(field, Rejected(BuiltInEventTypes.BellyMassage, json).Field);
    }

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"intensity":"mild"}""")]
    [InlineData("""{"intensity":"moderate","what_helped":"rocking"}""")]
    [InlineData("""{"intensity":"intense","what_helped":"nothing"}""")]
    [InlineData("""{"what_helped":"pacifier","pause_count":1,"paused_seconds":30}""")]
    public void Fussy_OptionalIntensityAndWhatHelped_AreAcceptedRunningOrEnded(string json)
    {
        Ensure(BuiltInEventTypes.Fussy, json, Ended);
        Ensure(BuiltInEventTypes.Fussy, json, null);
    }

    [Theory]
    [InlineData("""{"intensity":3}""", "intensity")]
    [InlineData("""{"intensity":"MILD"}""", "intensity")]
    [InlineData("""{"what_helped":"singing"}""", "what_helped")]
    [InlineData("""{"what_helped":true}""", "what_helped")]
    public void Fussy_UnknownIntensityOrWhatHelped_IsRejected(string json, string field)
    {
        Assert.Equal(field, Rejected(BuiltInEventTypes.Fussy, json).Field);
    }

    [Theory]
    [InlineData("""{"value_c":37.8,"method":"armpit"}""")]
    [InlineData("""{"value_c":37}""")]
    [InlineData("""{"value_c":30}""")]
    [InlineData("""{"value_c":45.0,"method":"rectal"}""")]
    [InlineData("""{"value_c":36.50}""")]
    public void Temperature_ValueInRangeWithOneDecimal_IsAccepted(string json)
    {
        Ensure(BuiltInEventTypes.Temperature, json, Ended);
    }

    [Theory]
    [InlineData("""{}""", "value_c")]
    [InlineData("""{"method":"ear"}""", "value_c")]
    [InlineData("""{"value_c":29.9}""", "value_c")]
    [InlineData("""{"value_c":45.1}""", "value_c")]
    [InlineData("""{"value_c":37.85}""", "value_c")]
    [InlineData("""{"value_c":"37.8"}""", "value_c")]
    [InlineData("""{"value_c":37.8,"method":"toe"}""", "method")]
    public void Temperature_MissingOutOfRangeOrTooPreciseValue_IsRejected(string json, string field)
    {
        Assert.Equal(field, Rejected(BuiltInEventTypes.Temperature, json).Field);
    }

    [Fact]
    public void Temperature_TooManyDecimals_MessageNamesTheLimit()
    {
        Assert.Equal("'value_c' must have at most 1 decimal place(s).", Rejected(BuiltInEventTypes.Temperature, """{"value_c":37.85}""").Message);
    }

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"stage":"gums_sore"}""")]
    [InlineData("""{"stage":"tooth_came_through"}""")]
    [InlineData("""{"stage":"tooth_came_through","tooth":"lower_central_incisor"}""")]
    [InlineData("""{"stage":"tooth_came_through","tooth":"other"}""")]
    public void Teething_ToothWithAToothThatCameThrough_IsAccepted(string json)
    {
        Ensure(BuiltInEventTypes.Teething, json, Ended);
    }

    [Theory]
    [InlineData("""{"tooth":"canine"}""", "tooth")]
    [InlineData("""{"stage":"gums_sore","tooth":"canine"}""", "tooth")]
    [InlineData("""{"stage":"tooth_came_through","tooth":"wisdom"}""", "tooth")]
    [InlineData("""{"stage":"erupted"}""", "stage")]
    public void Teething_ToothWithoutAToothThatCameThroughOrUnknownOption_IsRejected(string json, string field)
    {
        Assert.Equal(field, Rejected(BuiltInEventTypes.Teething, json).Field);
    }

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"milestone":"first_steps"}""")]
    [InlineData("""{"milestone":"other","custom":"Waved bye-bye"}""")]
    [InlineData("""{"milestone":"other"}""")]
    public void Milestone_CustomTextForOther_IsAccepted(string json)
    {
        Ensure(BuiltInEventTypes.Milestone, json, Ended);
    }

    [Theory]
    [InlineData("""{"custom":"Waved"}""", "custom")]
    [InlineData("""{"milestone":"sits","custom":"Waved"}""", "custom")]
    [InlineData("""{"milestone":"other","custom":3}""", "custom")]
    [InlineData("""{"milestone":"jumps"}""", "milestone")]
    public void Milestone_CustomTextWithoutOtherOrUnknownOption_IsRejected(string json, string field)
    {
        Assert.Equal(field, Rejected(BuiltInEventTypes.Milestone, json).Field);
    }

    [Theory]
    [InlineData("nail_trim", """{"where":"both"}""")]
    [InlineData("spit_up", """{"kind":"vomit","amount":"a_lot"}""")]
    [InlineData("symptom", """{"symptom":"runny_nose","severity":"mild"}""")]
    [InlineData("outdoor", """{"kind":"stroller_walk","pause_count":1,"paused_seconds":60}""")]
    [InlineData("skin_care", """{"product":"diaper_cream"}""")]
    [InlineData("nail_trim", """{}""")]
    [InlineData("spit_up", """{}""")]
    [InlineData("symptom", """{}""")]
    [InlineData("outdoor", """{}""")]
    [InlineData("skin_care", """{}""")]
    public void SelectOnlyTypes_KnownOptionsOrNothing_AreAccepted(string key, string json)
    {
        Ensure(BuiltInEventTypes.All.Single(type => type.Key.Value == key), json, Ended);
    }

    [Theory]
    [InlineData("nail_trim", """{"where":"toes"}""", "where")]
    [InlineData("spit_up", """{"kind":"burp"}""", "kind")]
    [InlineData("spit_up", """{"amount":"huge"}""", "amount")]
    [InlineData("symptom", """{"symptom":"fever"}""", "symptom")]
    [InlineData("symptom", """{"severity":"intense"}""", "severity")]
    [InlineData("outdoor", """{"kind":"beach"}""", "kind")]
    [InlineData("skin_care", """{"product":"SUNSCREEN"}""", "product")]
    public void SelectOnlyTypes_UnknownOption_IsRejected(string key, string json, string field)
    {
        Assert.Equal(field, Rejected(BuiltInEventTypes.All.Single(type => type.Key.Value == key), json).Field);
    }

    [Fact]
    public void Custom_NumberWithDecimals_AcceptsUpToThatManyPlaces()
    {
        var eventType = Custom(false, EventFieldDefinition.Create("weight", "Weight", EventFieldKind.Number, decimals: 2));

        Ensure(eventType, """{"weight":3.25}""", Ended);
        Ensure(eventType, """{"weight":3}""", Ended);
        Ensure(eventType, """{"weight":3.2500}""", Ended);
        Assert.Equal("weight", Rejected(eventType, """{"weight":3.251}""").Field);
        Assert.Equal("weight", Rejected(eventType, """{"weight":1e400}""").Field);
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
