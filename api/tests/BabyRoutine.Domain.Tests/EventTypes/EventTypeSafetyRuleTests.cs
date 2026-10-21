using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.EventTypes;

/// <summary>Icons and field definitions the web client could not render safely are rejected when a type is created or updated.</summary>
public sealed class EventTypeSafetyRuleTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly EventTypeKey Key = EventTypeKey.From("pumping");
    private static readonly HexColor Color = HexColor.From("#123456");

    [Theory]
    [InlineData("constructor")]
    [InlineData("__proto__")]
    [InlineData("toString")]
    [InlineData("opacity")]
    [InlineData("")]
    [InlineData("WATER_DROP")]
    public void CreateCustom_IconNotAllowed_ThrowsValidationOnIcon(string icon)
    {
        var exception = Assert.Throws<DomainValidationException>(() => Create(icon, []));

        Assert.Equal("Icon", exception.Field);
    }

    [Fact]
    public void CreateCustom_EveryAllowedIcon_IsAccepted()
    {
        Assert.All(EventTypeIcons.Names, icon => Assert.Equal(icon, Create($" {icon} ", []).Icon));
    }

    [Fact]
    public void Update_IconNotAllowed_ThrowsAndKeepsState()
    {
        var eventType = Create("water_drop", []);

        Assert.Throws<DomainValidationException>(() => eventType.Update("Pump", "hasOwnProperty", Color, hasDuration: false, []));
        Assert.Equal("water_drop", eventType.Icon);
    }

    [Fact]
    public void Names_MatchTheWebIconRegistry()
    {
        var registry = File.ReadAllText(FindInRepository(Path.Combine("web", "src", "events", "iconRegistry.ts")));
        var webNames = System.Text.RegularExpressions.Regex.Matches(registry, @"\b([a-z][a-z_]*)['""]?\s*[:,]\s*[A-Z]\w*Icon\b")
            .Select(match => match.Groups[1].Value)
            .Distinct(StringComparer.Ordinal);

        Assert.Equal(webNames.Order(StringComparer.Ordinal), EventTypeIcons.Names.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void BuiltIns_UseAllowedIcons()
    {
        Assert.All(BuiltInEventTypes.All, builtIn => Assert.True(EventTypeIcons.IsAllowed(builtIn.Icon), builtIn.Icon));
    }

    [Theory]
    [InlineData("constructor")]
    [InlineData("prototype")]
    public void CreateCustom_ReservedFieldKey_ThrowsValidationOnKey(string key)
    {
        var exception = Assert.Throws<DomainValidationException>(() => Create("star", [EventFieldDefinition.Create(key, "Label", EventFieldKind.Text)]));

        Assert.Equal("Key", exception.Field);
    }

    [Theory]
    [InlineData("__proto__")]
    [InlineData("toString")]
    [InlineData("valueOf")]
    [InlineData("hasOwnProperty")]
    public void FieldCreate_OtherReservedKeys_AreAlreadyRejectedAsNotSnakeCase(string key)
    {
        Assert.Throws<DomainValidationException>(() => EventFieldDefinition.Create(key, "Label", EventFieldKind.Text));
    }

    [Fact]
    public void ReservedFieldKeys_ListsPrototypeMembers()
    {
        Assert.All(new[] { "constructor", "__proto__", "prototype", "toString", "valueOf", "hasOwnProperty" }, key => Assert.Contains(key, EventType.ReservedFieldKeys));
    }

    [Fact]
    public void CreateCustom_TooManyFields_ThrowsValidationOnFields()
    {
        var fields = Enumerable.Range(0, EventType.MaxFields + 1).Select(index => EventFieldDefinition.Create($"field_{index}", "Label", EventFieldKind.Bool));

        var exception = Assert.Throws<DomainValidationException>(() => Create("star", fields));

        Assert.Equal("Fields", exception.Field);
    }

    [Fact]
    public void CreateCustom_MaxFields_IsAccepted()
    {
        var fields = Enumerable.Range(0, EventType.MaxFields).Select(index => EventFieldDefinition.Create($"field_{index}", "Label", EventFieldKind.Bool));

        Assert.Equal(EventType.MaxFields, Create("star", fields).Fields.Count);
    }

    [Fact]
    public void CreateCustom_TooManyOptions_ThrowsValidationOnOptions()
    {
        var options = Enumerable.Range(0, EventType.MaxOptionsPerField + 1).Select(index => $"option {index}");
        var field = EventFieldDefinition.Create("choice", "Choice", EventFieldKind.Select, options: options);

        var exception = Assert.Throws<DomainValidationException>(() => Create("star", [field]));

        Assert.Equal("Options", exception.Field);
    }

    private static string FindInRepository(string relativePath)
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, relativePath);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException($"{relativePath} not found above {AppContext.BaseDirectory}.");
    }

    private static EventType Create(string icon, IEnumerable<EventFieldDefinition> fields) =>
        EventType.CreateCustom(BabyId, Key, "Pumping", icon, Color, hasDuration: false, fields);
}
