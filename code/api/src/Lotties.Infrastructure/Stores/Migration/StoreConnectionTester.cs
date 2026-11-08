using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace Lotties.Infrastructure.Stores.Migration;

/// <summary>
/// The owner's "Test connection" (docs/design/47-bring-your-own-database.md section 3.4, task T6), on the migrator's own session
/// (task T5): unseal the descriptor, pin both endpoints through the egress guard, connect as the migrator, audit the app role
/// (connecting as it), then refuse a Lotties control database, a schema set up for another store and a schema newer than this API.
/// It reads only: nothing is migrated, locked or written, and the store's state is left to the migrator. Failures become coarse
/// codes (<see cref="StoreCheckResult"/>); a log line carries the store id, the code and the exception type, never its message
/// (Npgsql messages can echo a host or a user).
/// </summary>
internal sealed class StoreConnectionTester(IStoreMigrationSessionFactory sessions, ILogger<StoreConnectionTester> logger) : IStoreConnectionTester
{
    /// <summary>Postgres <c>invalid_password</c> and <c>invalid_authorization_specification</c>.</summary>
    private static readonly string[] AuthenticationSqlStates = [PostgresErrorCodes.InvalidPassword, PostgresErrorCodes.InvalidAuthorizationSpecification];

    public async Task<StoreCheckResult> TestAsync(DataStore store, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);
        try
        {
            await using var session = await sessions.OpenAsync(store, cancellationToken);
            return await CheckAsync(session, store, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            var result = Classify(exception);
            logger.LogInformation("Connection test of store {StoreId} failed: {Result} ({ErrorType})", store.Id, result.Code, exception.GetType().Name);
            return result;
        }
    }

    private static async Task<StoreCheckResult> CheckAsync(IStoreMigrationSession session, DataStore store, CancellationToken cancellationToken)
    {
        var audit = await session.AuditAppRoleAsync(cancellationToken);
        if (audit.IsTooPowerful)
        {
            return new StoreCheckResult(new StoreRoleTooPowerfulException(audit.Findings).Code, audit.Findings);
        }

        if (await session.HoldsControlTablesAsync(cancellationToken) || await HoldsAnotherStoreAsync(session, store, cancellationToken))
        {
            return StoreCheckResult.Failed(new StoreSchemaConflictException().Code);
        }

        var status = StoreSchemaStatus.Compare(await session.GetAppliedMigrationsAsync(cancellationToken), session.KnownMigrations);
        return status.Position == StoreSchemaPosition.Ahead ? StoreCheckResult.Failed(new StoreSchemaAheadException().Code) : StoreCheckResult.Ok;
    }

    private static async Task<bool> HoldsAnotherStoreAsync(IStoreMigrationSession session, DataStore store, CancellationToken cancellationToken) =>
        await session.ReadMetaAsync(cancellationToken) is { } meta && meta.StoreId != store.Id;

    private static StoreCheckResult Classify(Exception exception) => exception switch
    {
        DomainException domain => StoreCheckResult.Failed(domain.Code),
        _ when IsAuthenticationFailure(exception) => StoreCheckResult.Failed(StoreCheckResult.AuthFailedCode),
        _ => StoreCheckResult.Failed(new StoreUnavailableException().Code),
    };

    private static bool IsAuthenticationFailure(Exception exception) =>
        Chain(exception).OfType<PostgresException>().Any(postgres => AuthenticationSqlStates.Contains(postgres.SqlState, StringComparer.Ordinal));

    private static IEnumerable<Exception> Chain(Exception exception)
    {
        for (var current = exception; current is not null; current = current.InnerException)
        {
            yield return current;
        }
    }
}
