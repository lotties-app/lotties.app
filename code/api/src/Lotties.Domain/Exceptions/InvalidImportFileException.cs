namespace Lotties.Domain.Exceptions;

/// <summary>An uploaded import file is not valid CSV or lacks a required column.</summary>
public sealed class InvalidImportFileException : DomainException
{
    public InvalidImportFileException(string field, string message)
        : base("import_invalid_file", message)
    {
        Field = field;
    }

    public string Field { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["field"] = Field };
}
