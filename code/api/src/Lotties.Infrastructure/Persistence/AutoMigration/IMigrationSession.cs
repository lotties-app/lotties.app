namespace Lotties.Infrastructure.Persistence.AutoMigration;

/// <summary>One database session used for a migration run: the migration lock and the migrations share it.</summary>
internal interface IMigrationSession : IAsyncDisposable
{
    /// <summary>Takes the migration lock if it is free; false when another session holds it.</summary>
    Task<bool> TryAcquireLockAsync(CancellationToken cancellationToken = default);

    Task ReleaseLockAsync(CancellationToken cancellationToken = default);

    Task<IReadOnlyList<string>> GetPendingMigrationsAsync(CancellationToken cancellationToken = default);

    Task MigrateAsync(CancellationToken cancellationToken = default);
}

/// <summary>Opens <see cref="IMigrationSession"/>s with the migrator credentials.</summary>
internal interface IMigrationSessionFactory
{
    /// <summary>Database name and host for log messages; never contains credentials.</summary>
    string Target { get; }

    Task<IMigrationSession> OpenAsync(CancellationToken cancellationToken = default);
}
