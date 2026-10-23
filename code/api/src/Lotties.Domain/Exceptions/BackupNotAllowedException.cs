namespace Lotties.Domain.Exceptions;

/// <summary>
/// The caller may not export or import a baby's data: only an Owner or a Parent does (the endpoints check it first; the
/// services check again so another caller, such as the account deletion's "download my data" step, cannot skip it).
/// </summary>
public sealed class BackupNotAllowedException : DomainException
{
    public BackupNotAllowedException(Guid babyId)
        : base("backup_not_allowed", $"Only an Owner or a Parent may export or import the data of baby {babyId}.")
    {
        BabyId = babyId;
    }

    public Guid BabyId { get; }
}
