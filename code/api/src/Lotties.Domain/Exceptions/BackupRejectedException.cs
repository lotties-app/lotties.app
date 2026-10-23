namespace Lotties.Domain.Exceptions;

/// <summary>Some records of a backup are not valid for this baby; nothing was imported. <see cref="Issues"/> lists the first ones.</summary>
public sealed class BackupRejectedException : DomainException
{
    public BackupRejectedException(IReadOnlyList<IReadOnlyDictionary<string, object?>> issues, int total)
        : base("backup_rejected", $"{total} record(s) of the backup are not valid; nothing was imported.")
    {
        Issues = issues;
        Total = total;
    }

    public IReadOnlyList<IReadOnlyDictionary<string, object?>> Issues { get; }

    public int Total { get; }

    public override IReadOnlyDictionary<string, object?> Details =>
        new Dictionary<string, object?> { ["issues"] = Issues, ["issueCount"] = Total };
}
