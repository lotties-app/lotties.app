namespace Lotties.Domain.Exceptions;

/// <summary>A backup is larger than allowed (decompressed size, or the number of records of one kind).</summary>
public sealed class BackupTooLargeException : DomainException
{
    public BackupTooLargeException(string what, long max)
        : base("backup_too_large", $"The backup has too many {what}: at most {max} are accepted.")
    {
        What = what;
        Max = max;
    }

    public string What { get; }

    public long Max { get; }

    public override IReadOnlyDictionary<string, object?> Details =>
        new Dictionary<string, object?> { ["what"] = What, ["max"] = Max };
}
