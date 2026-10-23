namespace Lotties.Domain.Exceptions;

/// <summary>The backup was written with a schema version this server does not read (a newer app, or garbage).</summary>
public sealed class UnsupportedBackupVersionException : DomainException
{
    public UnsupportedBackupVersionException(int schemaVersion, int maxSupported)
        : base("backup_unsupported_version", $"This backup uses schema version {schemaVersion}; this server reads up to version {maxSupported}. Update the app and try again.")
    {
        SchemaVersion = schemaVersion;
        MaxSupported = maxSupported;
    }

    public int SchemaVersion { get; }

    public int MaxSupported { get; }

    public override IReadOnlyDictionary<string, object?> Details =>
        new Dictionary<string, object?> { ["schemaVersion"] = SchemaVersion, ["maxSupported"] = MaxSupported };
}
