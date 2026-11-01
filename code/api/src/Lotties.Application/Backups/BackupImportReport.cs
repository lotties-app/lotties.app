namespace Lotties.Application.Backups;

/// <summary>What importing a backup does (a preview, <see cref="Applied"/> false) or did (<see cref="Applied"/> true).</summary>
public sealed record BackupImportReport
{
    /// <summary><c>restore</c> (a new baby) or <c>merge</c> (into an existing one).</summary>
    public string Mode { get; init; } = string.Empty;

    public bool Applied { get; init; }

    /// <summary>False while <see cref="Issues"/> is not empty: nothing would be imported.</summary>
    public bool CanImport { get; init; }

    /// <summary>The baby the records go to: the existing one, or the one a restore creates (or created).</summary>
    public Guid BabyId { get; init; }

    /// <summary>For a restore: the baby this file was restored into before still exists, so this import adds to it instead of creating another.</summary>
    public bool BabyExists { get; init; }

    public BackupSource Source { get; init; } = new();

    /// <summary>Counts per section (<see cref="BackupFile.SectionOrder"/> without <c>baby</c>), in file order.</summary>
    public IReadOnlyDictionary<string, BackupKindCounts> Kinds { get; init; } = new Dictionary<string, BackupKindCounts>();

    /// <summary>The first records that are not valid for this baby (at most <see cref="BackupApplier.MaxIssues"/>).</summary>
    public IReadOnlyList<BackupIssue> Issues { get; init; } = [];

    /// <summary>How many records are not valid, including the ones not listed.</summary>
    public int IssueCount { get; init; }

    /// <summary>Things worth knowing before confirming (see <see cref="BackupNotice.Code"/>).</summary>
    public IReadOnlyList<BackupNotice> Notices { get; init; } = [];
}

/// <summary>Who wrote the file and which baby it is about.</summary>
public sealed record BackupSource
{
    public DateTimeOffset ExportedAt { get; init; }

    public int SchemaVersion { get; init; }

    public string? AppVersion { get; init; }

    public string? BabyName { get; init; }

    public DateOnly BirthDate { get; init; }
}

/// <summary>
/// What happens to the records of one section. <c>New</c> are created, <c>Unchanged</c> are already there as they are,
/// <c>Updated</c> exist and the file's copy is newer (sync rules), <c>Kept</c> exist and win (newer, or deleted in the file
/// while alive here, or a different definition), <c>Invalid</c> make the import impossible.
/// </summary>
public sealed record BackupKindCounts
{
    public int Total { get; init; }

    public int New { get; init; }

    public int Unchanged { get; init; }

    public int Updated { get; init; }

    public int Kept { get; init; }

    public int Invalid { get; init; }
}

/// <summary>A record that cannot be imported and why (the code is the one the normal write would answer with).</summary>
public sealed record BackupIssue
{
    public string Kind { get; init; } = string.Empty;

    public Guid? Id { get; init; }

    public string Code { get; init; } = string.Empty;

    public string Message { get; init; } = string.Empty;

    public string? Field { get; init; }
}

/// <summary>
/// A fact about the import. Codes: <c>authors_remapped</c> (records written by other people will show as yours),
/// <c>doctor_provenance_dropped</c> (prescriptions that came from a doctor's proposal become your own entries),
/// <c>doctor_measurements_flattened</c> (consultation measurements lose their "recorded by" mark),
/// <c>product_links_dropped</c> (medications whose catalog product this server does not know are kept without the link).
/// </summary>
public sealed record BackupNotice
{
    public string Code { get; init; } = string.Empty;

    public int Count { get; init; }
}
