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

        Assert.Equal(
            original.Select(field => (field.Key, field.Label, field.Kind, field.IsRequired, string.Join('|', field.Options), field.Min, field.Max, field.Unit)),
            restored.Select(field => (field.Key, field.Label, field.Kind, field.IsRequired, string.Join('|', field.Options), field.Min, field.Max, field.Unit)));
    }

    [Fact]
    public void Converter_WritesCamelCaseWithLowercaseKinds()
    {
        using var context = ModelTestContext.Create();
        var converter = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetTypeMapping().Converter!;

        var json = (string)converter.ConvertToProvider(BuiltInEventTypes.BellyPain.Fields)!;

        Assert.Equal("""[{"key":"intensity","label":"Intensity","kind":"number","isRequired":true,"min":1,"max":5}]""", json);
    }

    [Fact]
    public void Comparer_EqualContent_IsEqual()
    {
        using var context = ModelTestContext.Create();
        var comparer = context.Entity<EventType>().FindProperty(nameof(EventType.Fields))!.GetValueComparer();
        var copy = BuiltInEventTypes.Feeding.Fields
            .Select(field => EventFieldDefinition.Create(field.Key, field.Label, field.Kind, field.IsRequired, field.Options, field.Min, field.Max, field.Unit))
            .ToArray();

        Assert.True(comparer.Equals(BuiltInEventTypes.Feeding.Fields, copy));
        Assert.False(comparer.Equals(BuiltInEventTypes.Feeding.Fields, BuiltInEventTypes.BellyPain.Fields));
    }
}
