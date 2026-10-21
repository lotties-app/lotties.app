using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.EventTypes;

/// <summary>
/// A kind of event that can be logged. Built-in templates have no <see cref="BabyId"/> and are read-only;
/// custom types belong to one baby.
/// </summary>
public sealed class EventType
{
    public const int NameMaxLength = 100;
    public const int IconMaxLength = 64;

    private EventType()
    {
    }

    private EventType(
        Guid id,
        Guid? babyId,
        EventTypeKey key,
        string name,
        string icon,
        HexColor color,
        bool hasDuration,
        IReadOnlyList<EventFieldDefinition> fields)
    {
        Id = id;
        BabyId = babyId;
        Key = key;
        Name = name;
        Icon = icon;
        Color = color;
        HasDuration = hasDuration;
        Fields = fields;
    }

    public Guid Id { get; private set; }

    /// <summary>Owning baby; <c>null</c> for built-in templates.</summary>
    public Guid? BabyId { get; private set; }

    public EventTypeKey Key { get; private set; }

    public string Name { get; private set; } = string.Empty;

    /// <summary>Icon identifier interpreted by the client.</summary>
    public string Icon { get; private set; } = string.Empty;

    public HexColor Color { get; private set; }

    /// <summary>Whether events of this type have a start and an end (timer) rather than a single instant.</summary>
    public bool HasDuration { get; private set; }

    public IReadOnlyList<EventFieldDefinition> Fields { get; private set; } = Array.Empty<EventFieldDefinition>();

    public bool IsBuiltIn => BabyId is null;

    /// <summary>Whether events of <paramref name="babyId"/> may use this type: built-in templates or the baby's own custom types.</summary>
    public bool IsAvailableTo(Guid babyId) => IsBuiltIn || BabyId == babyId;

    public static EventType CreateCustom(
        Guid babyId,
        EventTypeKey key,
        string name,
        string icon,
        HexColor color,
        bool hasDuration,
        IEnumerable<EventFieldDefinition> fields) => new(
            Guid.NewGuid(),
            Ids.Required(babyId, nameof(babyId)),
            key,
            Text.Required(name, nameof(Name), NameMaxLength),
            Text.Required(icon, nameof(Icon), IconMaxLength),
            color,
            hasDuration,
            ValidateFields(fields));

    internal static EventType CreateBuiltIn(
        Guid id,
        EventTypeKey key,
        string name,
        string icon,
        HexColor color,
        bool hasDuration,
        IEnumerable<EventFieldDefinition> fields) => new(
            Ids.Required(id, nameof(id)),
            null,
            key,
            Text.Required(name, nameof(Name), NameMaxLength),
            Text.Required(icon, nameof(Icon), IconMaxLength),
            color,
            hasDuration,
            ValidateFields(fields));

    public void Update(string name, string icon, HexColor color, bool hasDuration, IEnumerable<EventFieldDefinition> fields)
    {
        EnsureCustom();
        var validatedName = Text.Required(name, nameof(Name), NameMaxLength);
        var validatedIcon = Text.Required(icon, nameof(Icon), IconMaxLength);
        Fields = ValidateFields(fields);
        Name = validatedName;
        Icon = validatedIcon;
        Color = color;
        HasDuration = hasDuration;
    }

    /// <summary>Throws <see cref="BuiltInEventTypeReadOnlyException"/> for built-in templates, which can never be deleted.</summary>
    public void EnsureDeletable() => EnsureCustom();

    private void EnsureCustom()
    {
        if (IsBuiltIn)
        {
            throw new BuiltInEventTypeReadOnlyException(Id);
        }
    }

    private static IReadOnlyList<EventFieldDefinition> ValidateFields(IEnumerable<EventFieldDefinition> fields)
    {
        ArgumentNullException.ThrowIfNull(fields);
        var definitions = fields.ToArray();
        var distinctKeys = definitions.Select(field => field.Key).Distinct(StringComparer.Ordinal).Count();
        return distinctKeys == definitions.Length
            ? Array.AsReadOnly(definitions)
            : throw new DomainValidationException(nameof(Fields), "Field keys must be unique within an event type.");
    }
}
