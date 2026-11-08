using Lotties.Application.Stores;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores.Failures;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Stores.Migration;

/// <summary>
/// The owner's "Test connection" (docs/design/47-bring-your-own-database.md section 3.4, task T6), on the migrator's own session
/// (task T5): unseal the descriptor, pin both endpoints through the egress guard, connect as the migrator, audit the app role
/// (connecting as it), then refuse a Lotties control database, a schema set up for another store and a schema newer than this API.
/// It reads only: nothing is migrated, locked or written, and the store's state is left to the migrator. Failures become coarse
/// codes: a refused host, port or CA keeps the egress guard's <c>endpoint_*</c> code, every other failure is classified by task T8's
/// <see cref="StoreFailureClassifier"/> (types and SQLSTATEs only). A log line carries the store id, the code and the exception type,
/// never its message (Npgsql messages can echo a host or a user). <see cref="ReadIdentityAsync"/> (new details of a store that holds a
/// baby's records) reads <c>lotties.store_meta</c> on the same pinned session, on both endpoints, and creates nothing either.
/// </summary>
internal sealed class StoreConnectionTester(IStoreMigrationSessionFactory sessions, ILogger<StoreConnectionTester> logger) : IStoreConnectionTester
{
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

    public async Task<StoreDatabaseIdentity> ReadIdentityAsync(DataStore candidate, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(candidate);
        try
        {
            await using var session = await sessions.OpenAsync(candidate, cancellationToken);
            var meta = await session.ReadMetaAsync(cancellationToken);
            return new StoreDatabaseIdentity(meta?.StoreId, await session.ReadAppStoreIdAsync(cancellationToken));
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            var failure = FailureOf(exception);
            logger.LogInformation("Identity check of store {StoreId} failed: {Result} ({ErrorType})", candidate.Id, failure.Code, exception.GetType().Name);
            throw failure;
        }
    }

    private static async Task<StoreCheckResult> CheckAsync(IStoreMigrationSession session, DataStore store, CancellationToken cancellationToken)
    {
        var audit = await session.AuditAppRoleAsync(cancellationToken);
        if (audit.IsTooPowerful)
        {
            return StoreCheckResult.Of(StoreFailureClass.RoleTooPowerful, audit.Findings);
        }

        if (await session.HoldsControlTablesAsync(cancellationToken) || await HoldsAnotherStoreAsync(session, store, cancellationToken))
        {
            return StoreCheckResult.Of(StoreFailureClass.SchemaConflict);
        }

        var status = StoreSchemaStatus.Compare(await session.GetAppliedMigrationsAsync(cancellationToken), session.KnownMigrations);
        return status.Position == StoreSchemaPosition.Ahead ? StoreCheckResult.Of(StoreFailureClass.SchemaAhead) : StoreCheckResult.Ok;
    }

    private static async Task<bool> HoldsAnotherStoreAsync(IStoreMigrationSession session, DataStore store, CancellationToken cancellationToken) =>
        await session.ReadMetaAsync(cancellationToken) is { } meta && meta.StoreId != store.Id;

    private static StoreCheckResult Classify(Exception exception) =>
        RefusedEndpointOf(exception) is { } refused
            ? StoreCheckResult.Rejected(refused)
            : StoreCheckResult.Of(FailureClassOf(exception));

    /// <summary>The same split as <see cref="Classify"/>, as an exception: the guard's own refusal, else a store failure of its class.</summary>
    private static DomainException FailureOf(Exception exception) =>
        RefusedEndpointOf(exception) is { } refused
            ? new StoreEndpointRejectedException(refused)
            : StoreFailureException.Of(FailureClassOf(exception));

    /// <summary>A host, port or CA the egress guard refuses (a TLS failure or a name that does not resolve is a store failure instead).</summary>
    private static StoreEndpointFailure? RefusedEndpointOf(Exception exception) =>
        exception is StoreEndpointRejectedException { Failure: not (StoreEndpointFailure.TlsFailed or StoreEndpointFailure.Unresolvable) } rejected
            ? rejected.Failure
            : null;

    private static StoreFailureClass FailureClassOf(Exception exception) =>
        StoreFailureClassifier.Classify(exception) ?? StoreFailureClass.Unavailable;
}
