using BabyRoutine.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Tests.Persistence;

public sealed class EventFieldDefinitionsConverterTests
{
    [Fact]
    public void Converter_RoundTripsFeedingFields()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetTypeMapping().Converter!;
        var original = BuiltInEventTypes.Feeding.Fields;

        var json = (string)converter.ConvertToProvider(original)!;
        var restored = (IReadOnlyList<EventFieldDefinition>)converter.ConvertFromProvider(json)!;

        Assert.Equal(original.Select(Describe), restored.Select(Describe));
    }

    [Fact]
    public void Converter_WritesVisibleWhenWithEqualsAndOmitsItWhenAbsent()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetTypeMapping().Converter!;
        var fields = new[]
        {
            EventFieldDefinition.Create("method", "Method", EventFieldKind.Select, options: ["bottle", "solid"]),
            EventFieldDefinition.Create("food", "Food", EventFieldKind.Text, visibleWhen: FieldVisibilityCondition.Create("method", ["solid"])),
        };

        var json = (string)converter.ConvertToProvider(fields)!;

        Assert.Equal(
            """[{"key":"method","label":"Method","kind":"select","isRequired":false,"options":["bottle","solid"]},{"key":"food","label":"Food","kind":"text","isRequired":false,"visibleWhen":{"field":"method","equals":["solid"]}}]""",
            json);
    }

    [Fact]
    public void Converter_ReadsDefinitionsStoredWithoutVisibleWhen()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetTypeMapping().Converter!;

        var restored = (IReadOnlyList<EventFieldDefinition>)converter.ConvertFromProvider("""[{"key":"side","label":"Side","kind":"select","isRequired":false,"options":["left","right"]}]""")!;

        Assert.Null(Assert.Single(restored).VisibleWhen);
    }

    private static string Describe(EventFieldDefinition field) =>
        string.Join(
            ';',
            field.Key,
            field.Label,
            field.Kind,
            field.IsRequired,
            string.Join('|', field.Options),
            field.Min,
            field.Max,
            field.Unit,
            field.VisibleWhen is null ? "-" : $"{field.VisibleWhen.Field}={string.Join('|', field.VisibleWhen.Values)}",
            field.IsHidden,
            field.IsInteger);

    [Fact]
    public void Converter_WritesCamelCaseWithLowercaseKinds()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetTypeMapping().Converter!;

        var json = (string)converter.ConvertToProvider(BuiltInEventTypes.BellyPain.Fields)!;

        Assert.Equal("""[{"key":"intensity","label":"Intensity","kind":"number","isRequired":true,"min":1,"max":5}]""", json);
    }

    [Fact]
    public void Converter_RoundTripsSleepFieldsWithHiddenAndIntegerFlags()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetTypeMapping().Converter!;
        var original = BuiltInEventTypes.Sleep.Fields;

        var restored = (IReadOnlyList<EventFieldDefinition>)converter.ConvertFromProvider((string)converter.ConvertToProvider(original)!)!;

        Assert.Equal(original.Select(Describe), restored.Select(Describe));
    }

    [Fact]
    public void Converter_WritesHiddenAndIntegerOnlyWhenTrue()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetTypeMapping().Converter!;
        var fields = new[]
        {
            EventFieldDefinition.Create("pause_count", "Pauses", EventFieldKind.Number, min: 0, isHidden: true, isInteger: true),
            EventFieldDefinition.Create("note", "Note", EventFieldKind.Text),
        };

        var json = (string)converter.ConvertToProvider(fields)!;

        Assert.Equal(
            """[{"key":"pause_count","label":"Pauses","kind":"number","isRequired":false,"min":0,"hidden":true,"integer":true},{"key":"note","label":"Note","kind":"text","isRequired":false}]""",
            json);
    }

    [Fact]
    public void Converter_ReadsDefinitionsStoredWithoutFlagsAsVisibleAndNotInteger()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetTypeMapping().Converter!;

        var restored = Assert.Single((IReadOnlyList<EventFieldDefinition>)converter.ConvertFromProvider("""[{"key":"amount","label":"Amount","kind":"number","isRequired":false}]""")!);

        Assert.Equal((false, false), (restored.IsHidden, restored.IsInteger));
    }

    [Fact]
    public void Comparer_EqualContent_IsEqual()
    {
        using var context = ModelTestContext.Create();
        var comparer = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetValueComparer();
        var copy = BuiltInEventTypes.Feeding.Fields
            .Select(field => EventFieldDefinition.Create(field.Key, field.Label, field.Kind, field.IsRequired, field.Options, field.Min, field.Max, field.Unit, field.VisibleWhen, field.IsHidden, field.IsInteger))
            .ToArray();

        Assert.True(comparer.Equals(BuiltInEventTypes.Feeding.Fields, copy));
        Assert.False(comparer.Equals(BuiltInEventTypes.Feeding.Fields, BuiltInEventTypes.BellyPain.Fields));
    }
}
