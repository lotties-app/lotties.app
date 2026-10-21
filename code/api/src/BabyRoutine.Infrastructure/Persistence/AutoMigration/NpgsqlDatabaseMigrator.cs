using Microsoft.Extensions.Logging;

namespace BabyRoutine.Infrastructure.Persistence.AutoMigration;

/// <summary>
/// Applies pending migrations while holding the PostgreSQL migration advisory lock, so instances starting together
/// migrate one after the other (the later ones find nothing pending). Waits up to
/// <see cref="DatabaseMigrationSettings.LockTimeout"/> for the lock, then throws <see cref="TimeoutException"/>.
/// The lock is released after the run, also when it fails; the session is closed in any case.
/// </summary>
internal sealed class NpgsqlDatabaseMigrator : IDatabaseMigrator
{
    private readonly IMigrationSessionFactory _sessions;
    private readonly DatabaseMigrationSettings _settings;
    private readonly TimeProvider _time;
    private readonly ILogger<NpgsqlDatabaseMigrator> _logger;

    public NpgsqlDatabaseMigrator(IMigrationSessionFactory sessions, DatabaseMigrationSettings settings, TimeProvider time, ILogger<NpgsqlDatabaseMigrator> logger)
    {
        _sessions = sessions ?? throw new ArgumentNullException(nameof(sessions));
        _settings = settings ?? throw new ArgumentNullException(nameof(settings));
        _time = time ?? throw new ArgumentNullException(nameof(time));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task MigrateAsync(CancellationToken cancellationToken = default)
    {
        var started = _time.GetTimestamp();
        await using var session = await _sessions.OpenAsync(cancellationToken);
        await AcquireLockAsync(session, cancellationToken);
        try
        {
            await ApplyPendingMigrationsAsync(session, cancellationToken);
        }
        finally
        {
            await ReleaseLockQuietlyAsync(session);
        }

        _logger.LogInformation("Database migration of {Target} finished in {ElapsedMilliseconds} ms", _sessions.Target, (long)_time.GetElapsedTime(started).TotalMilliseconds);
    }

    private async Task AcquireLockAsync(IMigrationSession session, CancellationToken cancellationToken)
    {
        if (await session.TryAcquireLockAsync(cancellationToken))
        {
            return;
        }

        _logger.LogInformation("Another instance holds the migration lock of {Target}; waiting up to {TimeoutSeconds} s", _sessions.Target, _settings.LockTimeout.TotalSeconds);
        var waitStarted = _time.GetTimestamp();
        do
        {
            await WaitBeforeRetryAsync(waitStarted, cancellationToken);
        }
        while (!await session.TryAcquireLockAsync(cancellationToken));
    }

    private Task WaitBeforeRetryAsync(long waitStarted, CancellationToken cancellationToken)
    {
        var remaining = _settings.LockTimeout - _time.GetElapsedTime(waitStarted);
        if (remaining <= TimeSpan.Zero)
        {
            throw new TimeoutException($"The database migration lock was not released within {_settings.LockTimeout.TotalSeconds} s.");
        }

        var delay = remaining < _settings.LockPollInterval ? remaining : _settings.LockPollInterval;
        return Task.Delay(delay, _time, cancellationToken);
    }

    private async Task ApplyPendingMigrationsAsync(IMigrationSession session, CancellationToken cancellationToken)
    {
        var pending = await session.GetPendingMigrationsAsync(cancellationToken);
        if (pending.Count == 0)
        {
            _logger.LogInformation("Database {Target} is up to date; no migrations to apply", _sessions.Target);
            return;
        }

        _logger.LogInformation("Applying {Count} pending migrations to {Target}: {Migrations}", pending.Count, _sessions.Target, string.Join(", ", pending));
        await session.MigrateAsync(cancellationToken);
        _logger.LogInformation("Applied {Count} migrations to {Target}", pending.Count, _sessions.Target);
    }

    private async Task ReleaseLockQuietlyAsync(IMigrationSession session)
    {
        try
        {
            await session.ReleaseLockAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Could not release the migration lock of {Target}; closing the session releases it", _sessions.Target);
        }
    }
}
