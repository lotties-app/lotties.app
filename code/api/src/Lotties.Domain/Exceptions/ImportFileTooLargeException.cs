namespace Lotties.Domain.Exceptions;

/// <summary>An uploaded import file is larger than allowed.</summary>
public sealed class ImportFileTooLargeException : DomainException
{
    public ImportFileTooLargeException(string field, long maxBytes)
        : base("import_file_too_large", $"{field} must be at most {maxBytes} bytes.")
    {
        Field = field;
        MaxBytes = maxBytes;
    }

    public string Field { get; }

    public long MaxBytes { get; }

    public override IReadOnlyDictionary<string, object?> Details => new Dictionary<string, object?> { ["field"] = Field, ["maxBytes"] = MaxBytes };
}
