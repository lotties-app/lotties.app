namespace BabyRoutine.Domain.Exceptions;

/// <summary>An uploaded import file has more data rows than allowed.</summary>
public sealed class ImportTooManyRowsException : DomainException
{
    public ImportTooManyRowsException(string field, int maxRows)
        : base("import_too_many_rows", $"{field} must have at most {maxRows} data rows.")
    {
        Field = field;
        MaxRows = maxRows;
    }

    public string Field { get; }

    public int MaxRows { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["field"] = Field, ["maxRows"] = MaxRows };
}
