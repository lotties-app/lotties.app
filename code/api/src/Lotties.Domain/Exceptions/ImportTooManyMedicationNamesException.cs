namespace Lotties.Domain.Exceptions;

/// <summary>An import's medicine rows name more distinct medications than allowed.</summary>
public sealed class ImportTooManyMedicationNamesException : DomainException
{
    public ImportTooManyMedicationNamesException(int maxNames)
        : base("import_too_many_medication_names", $"The medicine rows of the logs must name at most {maxNames} distinct medications.")
    {
        MaxNames = maxNames;
    }

    public int MaxNames { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["maxNames"] = MaxNames };
}
