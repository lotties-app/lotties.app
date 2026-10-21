using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace BabyRoutine.Infrastructure.Persistence.AutoMigration;

/// <summary>
/// A dedicated, unpooled connection with the migrator credentials and a <see cref="BabyRoutineDbContext"/> on it.
/// The lock is a session-level <c>pg_try_advisory_lock</c> on <see cref="LockKey"/>; closing the (unpooled)
/// connection releases it even if the explicit unlock fails.
/// </summary>
internal sealed class NpgsqlMigrationSession : IMigrationSession
{
    /// <summary>Fixed advisory lock key of the schema migration ("LOTTIESM" in ASCII); shared by every instance.</summary>
    internal const long LockKey = 0x4C4F54544945534D;

    private readonly NpgsqlConnection _connection;
    private readonly BabyRoutineDbContext _context;

    private NpgsqlMigrationSession(NpgsqlConnection connection, BabyRoutineDbContext context)
    {
        _connection = connection;
        _context = context;
    }

    /// <summary>Opens the connection; on failure it is disposed and the exception propagates.</summary>
    public static async Task<NpgsqlMigrationSession> OpenAsync(string connectionString, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);
        var connection = new NpgsqlConnection(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }

        var options = new DbContextOptionsBuilder<BabyRoutineDbContext>().UseBabyRoutineDatabase(connection).Options;
        return new NpgsqlMigrationSession(connection, new BabyRoutineDbContext((DbContextOptions<BabyRoutineDbContext>)options));
    }

    public async Task<bool> TryAcquireLockAsync(CancellationToken cancellationToken = default) =>
        await ExecuteLockFunctionAsync("SELECT pg_try_advisory_lock(@key)", cancellationToken);

    public async Task ReleaseLockAsync(CancellationToken cancellationToken = default) =>
        await ExecuteLockFunctionAsync("SELECT pg_advisory_unlock(@key)", cancellationToken);

    public async Task<IReadOnlyList<string>> GetPendingMigrationsAsync(CancellationToken cancellationToken = default) =>
        (await _context.Database.GetPendingMigrationsAsync(cancellationToken)).ToArray();

    public Task MigrateAsync(CancellationToken cancellationToken = default) => _context.Database.MigrateAsync(cancellationToken);

    public async ValueTask DisposeAsync()
    {
        await _context.DisposeAsync();
        await _connection.DisposeAsync();
    }

    private async Task<bool> ExecuteLockFunctionAsync(string sql, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(sql, _connection);
        command.Parameters.AddWithValue("key", LockKey);
        return await command.ExecuteScalarAsync(cancellationToken) is true;
    }
}
