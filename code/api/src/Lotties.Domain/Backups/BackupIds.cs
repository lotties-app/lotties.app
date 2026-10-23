using Lotties.Domain.Common;

namespace Lotties.Domain.Backups;

/// <summary>
/// Ids a backup import derives (UUID v5 in a fixed namespace), so importing the same file again finds what the first
/// import created. Records keep their own ids only when the file is merged into the baby it was exported from; into any
/// other baby (a restore, or a merge of another baby's file) every id is derived from the target baby, because the
/// primary keys are global and a record id can belong to one baby only.
/// </summary>
public static class BackupIds
{
    /// <summary>Namespace of all backup ids. Never change it: earlier imports would no longer be recognized.</summary>
    public static readonly Guid Namespace = new("0c7f6a52-8d1e-4b9a-a3c4-5e2b7d9f1a68");

    /// <summary>The baby a restore creates: derived from the importer and the baby of the file.</summary>
    public static Guid RestoredBaby(Guid importerUserId, Guid sourceBabyId) =>
        DeterministicGuid.Create(Namespace, $"baby|{importerUserId:N}|{sourceBabyId:N}");

    /// <summary>The id <paramref name="sourceId"/> of a <paramref name="kind"/> record gets in <paramref name="targetBabyId"/>.</summary>
    public static Guid Record(Guid targetBabyId, Guid sourceBabyId, string kind, Guid sourceId)
    {
        ArgumentException.ThrowIfNullOrEmpty(kind);
        return targetBabyId == sourceBabyId
            ? sourceId
            : DeterministicGuid.Create(Namespace, $"{kind}|{targetBabyId:N}|{sourceId:N}");
    }

    /// <summary>
    /// The stand-in for a user in an exported file: the same user always gets the same one in the same baby's files, and
    /// it cannot be used to look the user up.
    /// </summary>
    public static Guid Author(Guid babyId, Guid userId) =>
        DeterministicGuid.Create(Namespace, $"author|{babyId:N}|{userId:N}");
}
