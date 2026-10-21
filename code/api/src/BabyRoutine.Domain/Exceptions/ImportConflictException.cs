namespace BabyRoutine.Domain.Exceptions;

/// <summary>Records of the import were saved concurrently (e.g. the same file imported twice at once); nothing was saved.</summary>
public sealed class ImportConflictException : DomainException
{
    private const string ConflictMessage = "Some records of the import were saved concurrently; nothing was imported. Preview and import again.";

    public ImportConflictException()
        : base("import_conflict", ConflictMessage)
    {
    }

    public ImportConflictException(Exception innerException)
        : base("import_conflict", ConflictMessage, innerException)
    {
    }
}
