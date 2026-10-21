using System.Collections.Frozen;
using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Events;
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
    public const int MaxFields = 30;
    public const int MaxOptionsPerField = 50;

    /// <summary>
    /// Field keys that clash with JavaScript object members (the web client reads payloads as plain objects), compared
    /// ignoring case.
    /// </summary>
    public static readonly FrozenSet<string> ReservedFieldKeys = new[]
    {
        "constructor", "__proto__", "prototype", "tostring", "valueof", "hasownproperty",
    }.ToFrozenSet(StringComparer.OrdinalIgnoreCase);

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
            EventTypeIcons.Ensure(icon),
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
            EventTypeIcons.Ensure(icon),
            color,
            hasDuration,
            ValidateFields(fields));

    public void Update(string name, string icon, HexColor color, bool hasDuration, IEnumerable<EventFieldDefinition> fields)
    {
        EnsureCustom();
        var validatedName = Text.Required(name, nameof(Name), NameMaxLength);
        var validatedIcon = EventTypeIcons.Ensure(icon);
        Fields = ValidateFields(fields);
        Name = validatedName;
        Icon = validatedIcon;
        Color = color;
        HasDuration = hasDuration;
    }

    /// <summary>
    /// Checks <paramref name="payload"/> against the field definitions (see <see cref="EventPayloadFieldRules"/>):
    /// values match their field kind, select values are options, numbers are within range, hidden fields
    /// (<see cref="EventFieldDefinition.VisibleWhen"/> not met) hold no value and, once the event is complete (an
    /// instant type, or <paramref name="endedAt"/> set: a running timer may still be filled in), visible required fields
    /// are present. Members no field declares are left alone. Throws <see cref="DomainValidationException"/> with the
    /// field key.
    /// </summary>
    public void EnsureValidPayload(EventPayload payload, DateTimeOffset? endedAt) =>
        EventPayloadFieldRules.Ensure(Fields, payload, isComplete: !HasDuration || endedAt is not null);

    /// <summary>Throws <see cref="BuiltInEventTypeReadOnlyException"/> for built-in templates, which can never be deleted.</summary>
    public void EnsureDeletable() => EnsureCustom();

    private void EnsureCustom()
    {
        if (IsBuiltIn)
        {
            throw new BuiltInEventTypeReadOnlyException(Id);
        }
    }

    /// <remarks>
    /// The count, option, reserved-key and visibility rules apply when a type is created or updated, not when stored
    /// definitions are read back, so rows saved before these rules existed stay readable.
    /// </remarks>
    private static IReadOnlyList<EventFieldDefinition> ValidateFields(IEnumerable<EventFieldDefinition> fields)
    {
        ArgumentNullException.ThrowIfNull(fields);
        var definitions = fields.ToArray();
        EnsureFieldCount(definitions);
        Array.ForEach(definitions, EnsureAllowedField);
        EnsureUniqueKeys(definitions);
        FieldVisibilityRules.EnsureValid(definitions);
        return Array.AsReadOnly(definitions);
    }

    private static void EnsureUniqueKeys(EventFieldDefinition[] definitions)
    {
        var distinctKeys = definitions.Select(field => field.Key).Distinct(StringComparer.Ordinal).Count();
        if (distinctKeys != definitions.Length)
        {
            throw new DomainValidationException(nameof(Fields), "Field keys must be unique within an event type.");
        }
    }

    private static void EnsureFieldCount(EventFieldDefinition[] definitions)
    {
        if (definitions.Length > MaxFields)
        {
            throw new DomainValidationException(nameof(Fields), $"An event type can have at most {MaxFields} fields.");
        }
    }

    private static void EnsureAllowedField(EventFieldDefinition field)
    {
        if (ReservedFieldKeys.Contains(field.Key))
        {
            throw new DomainValidationException(nameof(EventFieldDefinition.Key), $"Field key '{field.Key}' is reserved.");
        }

        if (field.Options.Count > MaxOptionsPerField)
        {
            throw new DomainValidationException(nameof(EventFieldDefinition.Options), $"A select field can have at most {MaxOptionsPerField} options.");
        }
    }
}
