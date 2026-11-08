using Lotties.Application.Users;
using Lotties.Domain.Consents;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Stores;

/// <summary>
/// The owner's management of a baby's data store (docs/design/47-bring-your-own-database.md sections 3, 6 and 8, task T6): read the
/// status, save or replace the connection details (checked by the egress guard, then sealed), test the connection, remove a store
/// no baby uses, and start a move of the baby's records into it or back to Lotties (task T7; the copy runs in the background,
/// <see cref="IDataStoreMoveRunner"/>). Callers are the baby's Owner (the route policy) and the feature
/// flag and account allowlist were checked by the HTTP layer. One store per account (D11): the store of a baby is the one its
/// pointer names, else the caller's own. Nothing here logs, returns or puts in an exception a host, a user name, a database name
/// or a password.
/// </summary>
public interface IDataStoreService
{
    /// <summary>Where the baby's records are (<c>hosted</c> or <c>own</c>), the store's status and the latest move, never a secret.</summary>
    Task<DataStoreStatusResponse> GetAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Validates the typed fields, runs the egress guard on both endpoints, seals the descriptor and saves it in the caller's store
    /// (created on first save), which goes back to <c>pending</c>. Moves no data. While a baby's records are in the store the new
    /// details must open that same database (its <c>store_meta</c> names the store), else <c>store_not_same_database</c> (409) and
    /// nothing changes.
    /// </summary>
    Task<DataStoreStatusResponse> SaveAsync(Guid babyId, SaveDataStoreRequest request, CancellationToken cancellationToken = default);

    /// <summary>Connects to the saved store (guarded, bounded in time) and returns the coarse outcome, which is also recorded on the store.</summary>
    Task<DataStoreTestResponse> TestAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Removes the caller's store; refused (<c>store_in_use</c>) while this or any baby still points at it.</summary>
    Task RemoveAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Starts moving the baby's records from Lotties' database into the caller's store (BYO consent, a saved descriptor, the baby
    /// hosted and kept by its Owner alone, the store ready) and returns the started move; the baby's writes answer
    /// <c>store_moving</c> until it ends. Also the undo of a move out, while its old copy is kept.
    /// </summary>
    Task<DataStoreMoveStatus> MoveInAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Starts moving the baby's records from the caller's store back to Lotties' database (the baby must be in her store, and the store
    /// readable) and returns the started move. Also the undo of a move in, while its old copy is kept.
    /// </summary>
    Task<DataStoreMoveStatus> MoveOutAsync(Guid babyId, CancellationToken cancellationToken = default);
}

internal sealed class DataStoreService(
    ICurrentUser currentUser,
    IDataStoreRepository stores,
    IUserConsentRepository consents,
    IStoreDescriptorGuard descriptorGuard,
    IStoreCredentials credentials,
    IStoreConnectionTester tester,
    IStoreHealth health,
    DataStoreMoves moves,
    TimeProvider time,
    ILogger<DataStoreService> logger) : IDataStoreService
{
    /// <summary>The whole test is bounded (docs/design/47 section 3.4: one resolve, one connect, a fixed list of checks, 10 s).</summary>
    internal static readonly TimeSpan TestBudget = TimeSpan.FromSeconds(10);

    public async Task<DataStoreStatusResponse> GetAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var selection = await SelectAsync(babyId, cancellationToken);
        return DataStoreViews.Status(selection.Pointer, selection.Store, await moves.StatusAsync(babyId, cancellationToken));
    }

    public async Task<DataStoreStatusResponse> SaveAsync(Guid babyId, SaveDataStoreRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var selection = await SelectAsync(babyId, cancellationToken);
        await EnsureConsentAsync(selection.User, cancellationToken);
        var descriptor = (StoreDescriptor)request;
        await descriptorGuard.CheckAsync(descriptor, cancellationToken);
        var store = selection.Store ?? await AddStoreAsync(selection.User, cancellationToken);
        var sealedDescriptor = credentials.Seal(descriptor, SealContextOf(store));
        await EnsureSameDatabaseAsync(selection, store, sealedDescriptor, cancellationToken);
        store.ReplaceDescriptor(sealedDescriptor, descriptor.ProviderLabel, time.GetUtcNow());
        await stores.SaveChangesAsync(cancellationToken);
        health.Forget(store.Id);
        logger.LogInformation("Saved a new descriptor for data store {StoreId}; state {State}", store.Id, store.State);
        return DataStoreViews.Status(selection.Pointer, store);
    }

    public async Task<DataStoreTestResponse> TestAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var selection = await SelectAsync(babyId, cancellationToken);
        await EnsureConsentAsync(selection.User, cancellationToken);
        var store = ConfiguredStore(selection);
        var result = await RunTestAsync(store, cancellationToken);
        store.RecordCheck(result.Code, time.GetUtcNow());
        await stores.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Connection test of data store {StoreId}: {Result}", store.Id, result.Code);
        ThrowIfTransient(result);
        return DataStoreViews.Test(result, store.LastCheckedAt!.Value);
    }

    public async Task RemoveAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var selection = await SelectAsync(babyId, cancellationToken);
        if (selection.Store is not { } store)
        {
            return;
        }

        await EnsureNotInUseAsync(selection, store, cancellationToken);
        stores.Remove(store);
        await stores.SaveChangesAsync(cancellationToken);
        health.Forget(store.Id);
        logger.LogInformation("Removed data store {StoreId}", store.Id);
    }

    public async Task<DataStoreMoveStatus> MoveInAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var selection = await SelectAsync(babyId, cancellationToken);
        await EnsureConsentAsync(selection.User, cancellationToken);
        var store = ConfiguredStore(selection);
        return await moves.StartInAsync(babyId, selection.Pointer, store, selection.User, cancellationToken);
    }

    public async Task<DataStoreMoveStatus> MoveOutAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var selection = await SelectAsync(babyId, cancellationToken);
        return await moves.StartOutAsync(babyId, selection.Pointer, cancellationToken);
    }

    private static StoreSealContext SealContextOf(DataStore store) => new(store.Id, store.OwnerUserId);

    private static DataStore ConfiguredStore(StoreSelection selection) =>
        selection.Store is { HasDescriptor: true } store ? store : throw new DataStoreNotConfiguredException();

    /// <summary>The caller, the baby's pointer and the store it names (which must be the caller's), else the caller's own store.</summary>
    private async Task<StoreSelection> SelectAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var user = await currentUser.GetUserAsync(cancellationToken);
        var pointer = await stores.StoreOfBabyAsync(babyId, cancellationToken);
        var store = pointer is { } storeId
            ? await stores.FindAsync(storeId, cancellationToken)
            : await stores.FindByOwnerAsync(user.Id, cancellationToken);
        EnsureOwnedBy(store, user);
        return new StoreSelection(user, pointer, store);
    }

    private static void EnsureOwnedBy(DataStore? store, User user)
    {
        if (store is not null && store.OwnerUserId != user.Id)
        {
            throw new DataStoreNotOwnedException();
        }
    }

    private async Task EnsureConsentAsync(User user, CancellationToken cancellationToken)
    {
        if (await consents.FindAsync(user.Id, ConsentKind.ByoDatabase, cancellationToken) is not { IsGranted: true })
        {
            throw new ByoDatabaseConsentRequiredException();
        }
    }

    private async Task EnsureNotInUseAsync(StoreSelection selection, DataStore store, CancellationToken cancellationToken)
    {
        if (await HoldsRecordsAsync(selection, store, cancellationToken))
        {
            throw new DataStoreInUseException();
        }
    }

    /// <summary>Whether a baby's records are read from <paramref name="store"/>: this baby or another one points at it.</summary>
    private async Task<bool> HoldsRecordsAsync(StoreSelection selection, DataStore store, CancellationToken cancellationToken) =>
        selection.Pointer is not null || await stores.IsInUseAsync(store.Id, cancellationToken);

    /// <summary>
    /// New details of a store that holds a baby's records must open that same database (a new password, user, host or pooler of it):
    /// before anything is saved, both endpoints of the new details are read (read only, bounded like the test) and their
    /// <c>store_meta</c> must name this store. An empty database, a database set up for another store or one that cannot be checked
    /// is refused and the saved details stay. A store no baby points at yet (first save, records moved back) takes any database.
    /// </summary>
    private async Task EnsureSameDatabaseAsync(StoreSelection selection, DataStore store, SealedDescriptor sealedDescriptor, CancellationToken cancellationToken)
    {
        if (!await HoldsRecordsAsync(selection, store, cancellationToken))
        {
            return;
        }

        var identity = await ReadIdentityAsync(store.WithCandidateDescriptor(sealedDescriptor), cancellationToken);
        if (identity.IsOf(store.Id))
        {
            return;
        }

        logger.LogWarning("Refused new details of data store {StoreId}: they open another database", store.Id);
        throw new StoreNotSameDatabaseException();
    }

    private async Task<StoreDatabaseIdentity> ReadIdentityAsync(DataStore candidate, CancellationToken cancellationToken)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(TestBudget);
        try
        {
            return await tester.ReadIdentityAsync(candidate, budget.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw StoreFailureException.Of(StoreFailureClass.Timeout);
        }
    }

    /// <summary>
    /// The owner's first store (one per account in the MVP: every later save replaces its descriptor). Its id is derived from the
    /// owner, so when two first saves race, the second finds the row the first added and replaces its descriptor.
    /// </summary>
    private async Task<DataStore> AddStoreAsync(User user, CancellationToken cancellationToken)
    {
        var created = DataStore.Create(DataStore.FirstStoreIdOf(user.Id), user.Id, time.GetUtcNow());
        if (await stores.TryAddAsync(created, cancellationToken))
        {
            return created;
        }

        return await stores.FindAsync(created.Id, cancellationToken)
            ?? throw new InvalidOperationException("A concurrently created data store could not be loaded.");
    }

    private async Task<StoreCheckResult> RunTestAsync(DataStore store, CancellationToken cancellationToken)
    {
        using var budget = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budget.CancelAfter(TestBudget);
        try
        {
            return await tester.TestAsync(store, budget.Token);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return StoreCheckResult.Of(StoreFailureClass.Timeout);
        }
    }

    /// <summary>A store that is down for now (not a setup problem) is answered like any store failure: 503 with <c>Retry-After</c>.</summary>
    private static void ThrowIfTransient(StoreCheckResult result)
    {
        if (result.Failure is { } failure && StoreCheckResult.IsTransient(failure))
        {
            throw StoreFailureException.Of(failure);
        }
    }

    private sealed record StoreSelection(User User, Guid? Pointer, DataStore? Store);
}
