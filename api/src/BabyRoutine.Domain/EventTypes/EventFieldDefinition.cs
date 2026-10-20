using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.EventTypes;

/// <summary>
/// Definition of one field in an event's payload. <see cref="Options"/> apply only to
/// <see cref="EventFieldKind.Select"/>; <see cref="Min"/>, <see cref="Max"/> and <see cref="Unit"/> only to
/// <see cref="EventFieldKind.Number"/>.
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
        string? unit)
    {
        Key = key;
        Label = label;
        Kind = kind;
        IsRequired = isRequired;
        Options = options;
        Min = min;
        Max = max;
        Unit = unit;
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

    public static EventFieldDefinition Create(
        string key,
        string label,
        EventFieldKind kind,
        bool isRequired = false,
        IEnumerable<string>? options = null,
        decimal? min = null,
        decimal? max = null,
        string? unit = null)
    {
        var validatedKind = EnsureDefined(kind);
        return new EventFieldDefinition(
            EnsureKey(key),
            Text.Required(label, nameof(Label), LabelMaxLength),
            validatedKind,
            isRequired,
            ValidateOptions(validatedKind, options),
            ValidateNumberOnly(validatedKind, min, nameof(Min)),
            ValidateMax(validatedKind, min, max),
            ValidateUnit(validatedKind, unit));
    }

    private static string EnsureKey(string? key)
    {
        if (!Slug.IsValid(key))
        {
            throw new DomainValidationException(nameof(Key), $"Field key must be lower snake_case, start with a letter and be at most {Slug.MaxLength} characters.");
        }

        return key!;
    }

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

    private static string? ValidateUnit(EventFieldKind kind, string? unit)
    {
        var validated = Text.Optional(unit, nameof(Unit), UnitMaxLength);
        return validated is null || kind == EventFieldKind.Number
            ? validated
            : throw new DomainValidationException(nameof(Unit), "Unit applies only to number fields.");
    }
}
