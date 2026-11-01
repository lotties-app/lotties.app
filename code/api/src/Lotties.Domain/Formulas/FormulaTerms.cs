using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Formulas;

/// <summary>
/// The full editable state of a baby's formula (the infant formula the parents give): name (required, at most 60
/// characters), optional brand (60), stage (short text such as <c>2</c> or <c>1+</c>, 10), notes (1000) and the date
/// it was started (2000-01-01 to 2100-12-31), whether it is the baby's current formula and whether it is archived.
/// Text is trimmed, blank optional text is absent, NUL is rejected. An archived formula is never current
/// (<see cref="IsCurrent"/> is stored <c>false</c> when <see cref="IsArchived"/> is <c>true</c>). Compared by value, so
/// an idempotent replay changes nothing.
/// </summary>
public sealed record FormulaTerms
{
    public const int NameMaxLength = 60;
    public const int BrandMaxLength = 60;
    public const int StageMaxLength = 10;
    public const int NotesMaxLength = 1000;

    public static readonly DateOnly EarliestDate = new(2000, 1, 1);
    public static readonly DateOnly LatestDate = new(2100, 12, 31);

    private FormulaTerms(string name, string? brand, string? stage, string? notes, DateOnly? startedOn, bool isCurrent, bool isArchived)
    {
        Name = name;
        Brand = brand;
        Stage = stage;
        Notes = notes;
        StartedOn = startedOn;
        IsCurrent = isCurrent;
        IsArchived = isArchived;
    }

    public string Name { get; }

    public string? Brand { get; }

    public string? Stage { get; }

    public string? Notes { get; }

    public DateOnly? StartedOn { get; }

    public bool IsCurrent { get; }

    public bool IsArchived { get; }

    /// <summary>Validates every rule; throws <see cref="DomainValidationException"/> naming the field.</summary>
    public static FormulaTerms Create(string? name, string? brand, string? stage, string? notes, DateOnly? startedOn, bool isCurrent, bool isArchived) =>
        new(
            Text.Required(name, "name", NameMaxLength),
            Text.Optional(brand, "brand", BrandMaxLength),
            Text.Optional(stage, "stage", StageMaxLength),
            Text.Optional(notes, "notes", NotesMaxLength),
            EnsureDate(startedOn),
            isCurrent && !isArchived,
            isArchived);

    private static DateOnly? EnsureDate(DateOnly? startedOn)
    {
        if (startedOn is { } date && (date < EarliestDate || date > LatestDate))
        {
            throw new DomainValidationException("startedOn", $"startedOn must be between {EarliestDate:yyyy-MM-dd} and {LatestDate:yyyy-MM-dd}.");
        }

        return startedOn;
    }
}
