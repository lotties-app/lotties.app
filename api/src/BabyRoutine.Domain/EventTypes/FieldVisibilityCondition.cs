using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.EventTypes;

/// <summary>
/// Shows a field only while another select field of the same event type holds one of <see cref="Values"/>
/// (on the wire <c>{"field":"method","equals":["bottle"]}</c>). That the referenced field exists, is a select, offers
/// the values and that conditions form no cycle is checked by <see cref="EventType"/> when a type is created or updated.
/// </summary>
public sealed class FieldVisibilityCondition
{
    private FieldVisibilityCondition(string field, IReadOnlyList<string> values)
    {
        Field = field;
        Values = values;
    }

    /// <summary>Key of the controlling select field.</summary>
    public string Field { get; }

    /// <summary>Option values of <see cref="Field"/> for which the field is visible (<c>equals</c> on the wire).</summary>
    public IReadOnlyList<string> Values { get; }

    public static FieldVisibilityCondition Create(string? field, IEnumerable<string>? values) =>
        new(EnsureField(field), EnsureValues(values));

    /// <summary>Whether the controlling field's <paramref name="value"/> makes the field visible; an absent value never does.</summary>
    public bool IsMetBy(string? value) => value is not null && Values.Contains(value, StringComparer.Ordinal);

    private static string EnsureField(string? field) =>
        Slug.IsValid(field)
            ? field!
            : throw new DomainValidationException(nameof(EventFieldDefinition.VisibleWhen), "visibleWhen.field must be the key of another field of the type.");

    private static IReadOnlyList<string> EnsureValues(IEnumerable<string>? values)
    {
        var validated = (values ?? [])
            .Select(value => Text.Required(value, nameof(EventFieldDefinition.VisibleWhen), EventFieldDefinition.OptionMaxLength))
            .ToArray();
        return validated.Length > 0 && validated.Distinct(StringComparer.Ordinal).Count() == validated.Length
            ? Array.AsReadOnly(validated)
            : throw new DomainValidationException(nameof(EventFieldDefinition.VisibleWhen), "visibleWhen.equals needs at least one value and values must be unique.");
    }
}
