using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.EventTypes;

public sealed class EventTypeTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly EventTypeKey Key = EventTypeKey.From("pumping");
    private static readonly HexColor Color = HexColor.From("#123456");

    [Fact]
    public void CreateCustom_Valid_IsBabyScoped()
    {
        var eventType = EventType.CreateCustom(BabyId, Key, "Pumping", "water_drop", Color, hasDuration: true, []);

        Assert.Equal(BabyId, eventType.BabyId);
        Assert.False(eventType.IsBuiltIn);
        Assert.True(eventType.HasDuration);
        Assert.Empty(eventType.Fields);
    }

    [Fact]
    public void CreateCustom_DuplicateFieldKeys_ThrowsValidation()
    {
        var fields = new[]
        {
            EventFieldDefinition.Create("side", "Side", EventFieldKind.Text),
            EventFieldDefinition.Create("side", "Other side", EventFieldKind.Bool),
        };

        Assert.Throws<DomainValidationException>(
            () => EventType.CreateCustom(BabyId, Key, "Pumping", "water_drop", Color, hasDuration: false, fields));
    }

    [Fact]
    public void CreateCustom_BlankIcon_ThrowsValidation()
    {
        Assert.Throws<DomainValidationException>(
            () => EventType.CreateCustom(BabyId, Key, "Pumping", " ", Color, hasDuration: false, []));
    }

    [Fact]
    public void CreateCustom_EmptyBaby_ThrowsArgument()
    {
        Assert.Throws<ArgumentException>(
            () => EventType.CreateCustom(Guid.Empty, Key, "Pumping", "water_drop", Color, hasDuration: false, []));
    }

    [Fact]
    public void Update_Custom_ReplacesDetails()
    {
        var eventType = EventType.CreateCustom(BabyId, Key, "Pumping", "water_drop", Color, hasDuration: false, []);
        var field = EventFieldDefinition.Create("amount", "Amount", EventFieldKind.Number, unit: "ml");

        eventType.Update("Pump", "opacity", HexColor.From("#654321"), hasDuration: true, [field]);

        Assert.Equal(("Pump", "opacity", "#654321", true), (eventType.Name, eventType.Icon, eventType.Color.Value, eventType.HasDuration));
        Assert.Same(field, Assert.Single(eventType.Fields));
        Assert.Equal(Key, eventType.Key);
    }

    [Fact]
    public void Update_InvalidFields_ThrowsAndKeepsState()
    {
        var eventType = EventType.CreateCustom(BabyId, Key, "Pumping", "water_drop", Color, hasDuration: false, []);
        var duplicate = EventFieldDefinition.Create("a", "A", EventFieldKind.Text);

        Assert.Throws<DomainValidationException>(
            () => eventType.Update("Pump", "opacity", Color, hasDuration: true, [duplicate, duplicate]));
        Assert.Equal("Pumping", eventType.Name);
        Assert.False(eventType.HasDuration);
    }

    [Fact]
    public void Update_BuiltIn_ThrowsReadOnly()
    {
        var builtIn = BuiltInEventTypes.Sleep;

        Assert.Throws<BuiltInEventTypeReadOnlyException>(
            () => builtIn.Update("Nap", "bedtime", Color, hasDuration: true, []));
        Assert.Equal("Sleep", builtIn.Name);
    }

    [Fact]
    public void IsAvailableTo_BuiltIn_AnyBaby()
    {
        Assert.True(BuiltInEventTypes.Sleep.IsAvailableTo(Guid.NewGuid()));
    }

    [Fact]
    public void IsAvailableTo_Custom_OnlyOwningBaby()
    {
        var eventType = EventType.CreateCustom(BabyId, Key, "Pumping", "water_drop", Color, hasDuration: false, []);

        Assert.Equal((true, false), (eventType.IsAvailableTo(BabyId), eventType.IsAvailableTo(Guid.NewGuid())));
    }
}
