using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Imports;

namespace BabyRoutine.Domain.Prescriptions;

/// <summary>
/// A label shared by prescriptions of one baby whose doses share one interval clock (e.g. <c>colic</c>): a dose of any
/// member starts the interval for all. Normalised like medication names (lower case, no diacritics, single spaces) so
/// "Cólica" and "colica" are the same group; 1-50 characters.
/// </summary>
public readonly record struct IntervalGroup
{
    public const int MaxLength = 50;
    public const string Field = "intervalGroup";

    private IntervalGroup(string value)
    {
        Value = value;
    }

    public string Value { get; }

    /// <summary>The group of <paramref name="text"/>, or <c>null</c> when it is null or blank.</summary>
    public static IntervalGroup? FromOptional(string? text)
    {
        var trimmed = Text.Optional(text, Field, MaxLength);
        return trimmed is null ? null : new IntervalGroup(MedicationNameMatcher.Normalize(trimmed));
    }

    /// <summary>Restores a stored (already normalised) value.</summary>
    public static IntervalGroup Rehydrate(string value) =>
        string.IsNullOrWhiteSpace(value) ? throw new DomainValidationException(Field, "intervalGroup must not be blank.") : new IntervalGroup(value);

    public override string ToString() => Value;
}
