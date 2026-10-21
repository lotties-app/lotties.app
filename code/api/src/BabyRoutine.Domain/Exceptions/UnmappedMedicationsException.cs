namespace BabyRoutine.Domain.Exceptions;

/// <summary>An import would create medication events whose medication names were given no mapping.</summary>
public sealed class UnmappedMedicationsException : DomainException
{
    public UnmappedMedicationsException(IReadOnlyList<string> tokens)
        : base("import_unmapped_medications", $"Map every medication name before importing; unmapped: {string.Join(", ", tokens)}.")
    {
        Tokens = tokens;
    }

    public IReadOnlyList<string> Tokens { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["tokens"] = Tokens };
}
