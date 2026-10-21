using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.EventTypes;

/// <summary>
/// Definition of one field in an event's payload. <see cref="Options"/> apply only to
/// <see cref="EventFieldKind.Select"/>; <see cref="Min"/>, <see cref="Max"/> and <see cref="Unit"/> only to
/// <see cref="EventFieldKind.Number"/>. <see cref="VisibleWhen"/> (any kind) shows the field only for some values of
/// another select field; a field hidden that way is never required and must not hold a value. <see cref="IsHidden"/> is
/// unrelated: such a field is validated like any other but clients do not render it in their forms (it is filled by
/// dedicated UI, e.g. timer pauses, or kept only so older events stay valid). <see cref="IsInteger"/> (number fields
/// only) accepts whole numbers only.
/// </summary>
public sealed class EventFieldDefinition
{
    public const int LabelMaxLength = 100;
    public const int OptionMaxLength = 50;
    public const int UnitMaxLength = 20;

    private EventFieldDefinition(
        string key,
        string label,
        EventFieldKind kind,
        bool isRequired,
        IReadOnlyList<string> options,
        decimal? min,
        decimal? max,
        string? unit,
        FieldVisibilityCondition? visibleWhen,
        bool isHidden,
        bool isInteger)
    {
        Key = key;
        Label = label;
        Kind = kind;
        IsRequired = isRequired;
        Options = options;
        Min = min;
        Max = max;
        Unit = unit;
        VisibleWhen = visibleWhen;
        IsHidden = isHidden;
        IsInteger = isInteger;
    }

    /// <summary>Lower snake_case property name inside the event payload.</summary>
    public string Key { get; }

    public string Label { get; }

    public EventFieldKind Kind { get; }

    public bool IsRequired { get; }

    public IReadOnlyList<string> Options { get; }

    public decimal? Min { get; }

    public decimal? Max { get; }

    public string? Unit { get; }

    /// <summary>When set, the field applies only while the referenced select field holds one of the listed values.</summary>
    public FieldVisibilityCondition? VisibleWhen { get; }

    /// <summary>Validated like any field, but not rendered by client forms.</summary>
    public bool IsHidden { get; }

    /// <summary>Number fields only: the value must be a whole number.</summary>
    public bool IsInteger { get; }

    public static EventFieldDefinition Create(
        string key,
        string label,
        EventFieldKind kind,
        bool isRequired = false,
        IEnumerable<string>? options = null,
        decimal? min = null,
        decimal? max = null,
        string? unit = null,
        FieldVisibilityCondition? visibleWhen = null,
        bool isHidden = false,
        bool isInteger = false)
    {
        var validatedKind = EnsureDefined(kind);
        var validatedKey = EnsureKey(key);
        return new EventFieldDefinition(
            validatedKey,
            Text.Required(label, nameof(Label), LabelMaxLength),
            validatedKind,
            isRequired,
            ValidateOptions(validatedKind, options),
            ValidateNumberOnly(validatedKind, min, nameof(Min)),
            ValidateMax(validatedKind, min, max),
            ValidateUnit(validatedKind, unit),
            EnsureNotSelfReferencing(validatedKey, visibleWhen),
            isHidden,
            ValidateIntegerFlag(validatedKind, isInteger));
    }

    private static string EnsureKey(string? key)
    {
        if (!Slug.IsValid(key))
        {
            throw new DomainValidationException(nameof(Key), $"Field key must be lower snake_case, start with a letter and be at most {Slug.MaxLength} characters.");
        }

        return key!;
    }

    private static FieldVisibilityCondition? EnsureNotSelfReferencing(string key, FieldVisibilityCondition? visibleWhen) =>
        visibleWhen is null || !string.Equals(visibleWhen.Field, key, StringComparison.Ordinal)
            ? visibleWhen
            : throw new DomainValidationException(nameof(VisibleWhen), $"Field '{key}' cannot depend on itself.");

    private static EventFieldKind EnsureDefined(EventFieldKind kind)
    {
        if (!Enum.IsDefined(kind))
        {
            throw new DomainValidationException(nameof(Kind), $"Field kind {kind} is not supported.");
        }

        return kind;
    }

    private static IReadOnlyList<string> ValidateOptions(EventFieldKind kind, IEnumerable<string>? options)
    {
        var values = (options ?? []).Select(option => Text.Required(option, nameof(Options), OptionMaxLength)).ToArray();
        if (kind != EventFieldKind.Select)
        {
            return values.Length == 0
                ? Array.Empty<string>()
                : throw new DomainValidationException(nameof(Options), "Only select fields can have options.");
        }

        return values.Length > 0 && values.Distinct(StringComparer.Ordinal).Count() == values.Length
            ? Array.AsReadOnly(values)
            : throw new DomainValidationException(nameof(Options), "Select fields need at least one option and options must be unique.");
    }

    private static decimal? ValidateNumberOnly(EventFieldKind kind, decimal? value, string field) =>
        value is null || kind == EventFieldKind.Number
            ? value
            : throw new DomainValidationException(field, $"{field} applies only to number fields.");

    private static decimal? ValidateMax(EventFieldKind kind, decimal? min, decimal? max)
    {
        var validated = ValidateNumberOnly(kind, max, nameof(Max));
        return min is null || validated is null || min <= validated
            ? validated
            : throw new DomainValidationException(nameof(Max), "Max must be greater than or equal to Min.");
    }

    private static bool ValidateIntegerFlag(EventFieldKind kind, bool isInteger) =>
        !isInteger || kind == EventFieldKind.Number
            ? isInteger
            : throw new DomainValidationException(nameof(IsInteger), "Only number fields can be integer.");

    private static string? ValidateUnit(EventFieldKind kind, string? unit)
    {
        var validated = Text.Optional(unit, nameof(Unit), UnitMaxLength);
        return validated is null || kind == EventFieldKind.Number
            ? validated
            : throw new DomainValidationException(nameof(Unit), "Unit applies only to number fields.");
    }
}
