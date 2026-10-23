namespace Lotties.Domain.Exceptions;

/// <summary>
/// The baby an earlier restore of this file created is no longer the importer's (she left it), so the file cannot be
/// restored again as a new baby; merge it into a baby she has instead.
/// </summary>
public sealed class BackupBabyUnavailableException : DomainException
{
    public BackupBabyUnavailableException()
        : base("backup_baby_unavailable", "This backup was already restored into a baby you no longer have access to. Merge it into one of your babies instead.")
    {
    }
}
