using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.EventTypes;

/// <summary>Rules of <see cref="EventFieldDefinition.VisibleWhen"/>: its own shape, and how it must reference the type's fields.</summary>
public sealed class FieldVisibilityTests
{
    private static readonly HexColor Color = HexColor.From("#123456");

    private static EventFieldDefinition Method(params string[] options) =>
        EventFieldDefinition.Create("method", "Method", EventFieldKind.Select, options: options.Length == 0 ? ["bottle", "solid"] : options);

    private static FieldVisibilityCondition When(string field, params string[] values) => FieldVisibilityCondition.Create(field, values);

    private static EventType Custom(params EventFieldDefinition[] fields) =>
        EventType.CreateCustom(Guid.NewGuid(), EventTypeKey.From("meal"), "Meal", "restaurant", Color, hasDuration: false, fields);

    [Fact]
    public void Create_ValidCondition_KeepsFieldAndValues()
    {
        var condition = When("method", "bottle", "solid");

        Assert.Equal("method", condition.Field);
        Assert.Equal(["bottle", "solid"], condition.Values);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Method")]
    [InlineData("method\n")]
    public void Create_FieldNotASnakeCaseKey_ThrowsOnVisibleWhen(string? field)
    {
        var exception = Assert.Throws<DomainValidationException>(() => FieldVisibilityCondition.Create(field, ["bottle"]));

        Assert.Equal("VisibleWhen", exception.Field);
    }

    [Fact]
    public void Create_NoValues_ThrowsOnVisibleWhen()
    {
        Assert.Equal("VisibleWhen", Assert.Throws<DomainValidationException>(() => FieldVisibilityCondition.Create("method", [])).Field);
        Assert.Equal("VisibleWhen", Assert.Throws<DomainValidationException>(() => FieldVisibilityCondition.Create("method", null)).Field);
    }

    [Theory]
    [InlineData("bottle", "bottle")]
    [InlineData("bo\0ttle", "solid")]
    [InlineData(" ", "solid")]
    public void Create_DuplicateBlankOrNulValue_ThrowsOnVisibleWhen(string first, string second)
    {
        var exception = Assert.Throws<DomainValidationException>(() => FieldVisibilityCondition.Create("method", [first, second]));

        Assert.Equal("VisibleWhen", exception.Field);
    }

    [Theory]
    [InlineData("bottle", true)]
    [InlineData("solid", false)]
    [InlineData("BOTTLE", false)]
    [InlineData(null, false)]
    public void IsMetBy_ComparesOrdinally(string? value, bool expected)
    {
        Assert.Equal(expected, When("method", "bottle").IsMetBy(value));
    }

    [Fact]
    public void FieldCreate_WithCondition_ExposesIt()
    {
        var food = EventFieldDefinition.Create("food", "Food", EventFieldKind.Text, visibleWhen: When("method", "solid"));

        Assert.Equal("method", food.VisibleWhen?.Field);
    }

    [Fact]
    public void FieldCreate_DependingOnItself_ThrowsOnVisibleWhen()
    {
        var exception = Assert.Throws<DomainValidationException>(() =>
            EventFieldDefinition.Create("method", "Method", EventFieldKind.Select, options: ["a"], visibleWhen: When("method", "a")));

        Assert.Equal("VisibleWhen", exception.Field);
    }

    [Fact]
    public void CreateCustom_ConditionOnASelectOption_IsAccepted()
    {
        var eventType = Custom(Method(), EventFieldDefinition.Create("food", "Food", EventFieldKind.Text, visibleWhen: When("method", "solid")));

        Assert.Equal(["solid"], eventType.Fields[1].VisibleWhen!.Values);
    }

    [Fact]
    public void CreateCustom_ConditionOnAMissingField_ThrowsOnVisibleWhen()
    {
        var exception = Assert.Throws<DomainValidationException>(() =>
            Custom(EventFieldDefinition.Create("food", "Food", EventFieldKind.Text, visibleWhen: When("method", "solid"))));

        Assert.Equal("VisibleWhen", exception.Field);
        Assert.Contains("'method'", exception.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(EventFieldKind.Text)]
    [InlineData(EventFieldKind.Number)]
    [InlineData(EventFieldKind.Bool)]
    public void CreateCustom_ConditionOnANonSelectField_ThrowsOnVisibleWhen(EventFieldKind kind)
    {
        var controller = EventFieldDefinition.Create("method", "Method", kind);

        var exception = Assert.Throws<DomainValidationException>(() =>
            Custom(controller, EventFieldDefinition.Create("food", "Food", EventFieldKind.Text, visibleWhen: When("method", "solid"))));

        Assert.Equal("VisibleWhen", exception.Field);
    }

    [Fact]
    public void CreateCustom_ConditionValueNotAnOption_ThrowsNamingTheValue()
    {
        var exception = Assert.Throws<DomainValidationException>(() =>
            Custom(Method(), EventFieldDefinition.Create("food", "Food", EventFieldKind.Text, visibleWhen: When("method", "solid", "Solid"))));

        Assert.Equal("VisibleWhen", exception.Field);
        Assert.Contains("Solid", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void CreateCustom_ChainedConditions_AreAccepted()
    {
        var eventType = Custom(
            Method(),
            EventFieldDefinition.Create("brand", "Brand", EventFieldKind.Select, options: ["a", "b"], visibleWhen: When("method", "bottle")),
            EventFieldDefinition.Create("batch", "Batch", EventFieldKind.Text, visibleWhen: When("brand", "b")));

        Assert.Equal(3, eventType.Fields.Count);
    }

    [Fact]
    public void CreateCustom_CyclicConditions_ThrowOnVisibleWhen()
    {
        var first = EventFieldDefinition.Create("first", "First", EventFieldKind.Select, options: ["a"], visibleWhen: When("second", "b"));
        var second = EventFieldDefinition.Create("second", "Second", EventFieldKind.Select, options: ["b"], visibleWhen: When("first", "a"));

        var exception = Assert.Throws<DomainValidationException>(() => Custom(first, second));

        Assert.Equal("VisibleWhen", exception.Field);
        Assert.Contains("cycle", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Update_InvalidCondition_ThrowsAndKeepsFields()
    {
        var eventType = Custom(Method());

        Assert.Throws<DomainValidationException>(() =>
            eventType.Update("Meal", "restaurant", Color, hasDuration: false, [EventFieldDefinition.Create("food", "Food", EventFieldKind.Text, visibleWhen: When("method", "solid"))]));

        Assert.Equal(["method"], eventType.Fields.Select(field => field.Key));
    }

    [Fact]
    public void BuiltIns_SatisfyTheVisibilityRules()
    {
        Assert.All(BuiltInEventTypes.All, builtIn =>
            Custom([.. builtIn.Fields]));
    }
}
