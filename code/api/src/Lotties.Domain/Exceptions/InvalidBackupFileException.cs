namespace Lotties.Domain.Exceptions;

/// <summary>An uploaded backup is not a Lotties backup file (not JSON, wrong format, truncated, a count or id that does not match).</summary>
public sealed class InvalidBackupFileException : DomainException
{
    public InvalidBackupFileException(string message)
        : base("backup_invalid_file", message)
    {
    }

    public InvalidBackupFileException(string message, Exception innerException)
        : base("backup_invalid_file", message, innerException)
    {
    }
}
