namespace Lotties.Domain.Exceptions;

/// <summary>The content of a backup does not match its checksum: the file was edited or damaged after it was exported.</summary>
public sealed class BackupChecksumMismatchException : DomainException
{
    public BackupChecksumMismatchException()
        : base("backup_checksum_mismatch", "The backup does not match its checksum: it was changed or damaged after it was exported. Export it again.")
    {
    }
}
