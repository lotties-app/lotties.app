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
/// no baby uses, and the move routes (not built yet, task T7). Callers are the baby's Owner (the route policy) and the feature
/// flag and account allowlist were checked by the HTTP layer. One store per account (D11): the store of a baby is the one its
/// pointer names, else the caller's own. Nothing here logs, returns or puts in an exception a host, a user name, a database name
/// or a password.
/// </summary>
public interface IDataStoreService
{
    /// <summary>Where the baby's records are (<c>hosted</c> or <c>own</c>) and the store's status, never a secret.</summary>
    Task<DataStoreStatusResponse> GetAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Validates the typed fields, runs the egress guard on both endpoints, seals the descriptor and saves it in the caller's store
    /// (created on first save), which goes back to <c>pending</c>. Moves no data.
    /// </summary>
    Task<DataStoreStatusResponse> SaveAsync(Guid babyId, SaveDataStoreRequest request, CancellationToken cancellationToken = default);

    /// <summary>Connects to the saved store (guarded, bounded in time) and returns the coarse outcome, which is also recorded on the store.</summary>
    Task<DataStoreTestResponse> TestAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Removes the caller's store; refused (<c>store_in_use</c>) while this or any baby still points at it.</summary>
    Task RemoveAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Checks the move into the store may be asked for, then answers <c>not_implemented</c> (task T7 builds the copy).</summary>
    Task MoveInAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Answers <c>not_implemented</c> (task T7 builds the copy back to Lotties).</summary>
    Task MoveOutAsync(Guid babyId, CancellationToken cancellationToken = default);
}

internal sealed class DataStoreService(
    ICurrentUser currentUser,
    IDataStoreRepository stores,
    IUserConsentRepository consents,
    IStoreDescriptorGuard descriptorGuard,
    IStoreCredentials credentials,
    IStoreConnectionTester tester,
    IStoreHealth health,
    TimeProvider time,
    ILogger<DataStoreService> logger) : IDataStoreService
{
    /// <summary>The whole test is bounded (docs/design/47 section 3.4: one resolve, one connect, a fixed list of checks, 10 s).</summary>
    internal static readonly TimeSpan TestBudget = TimeSpan.FromSeconds(10);

    public async Task<DataStoreStatusResponse> GetAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var selection = await SelectAsync(babyId, cancellationToken);
        return DataStoreViews.Status(selection.Pointer, selection.Store);
    }

    public async Task<DataStoreStatusResponse> SaveAsync(Guid babyId, SaveDataStoreRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var selection = await SelectAsync(babyId, cancellationToken);
        await EnsureConsentAsync(selection.User, cancellationToken);
        var descriptor = (StoreDescriptor)request;
        await descriptorGuard.CheckAsync(descriptor, cancellationToken);
        var store = selection.Store ?? AddStore(selection.User);
        store.ReplaceDescriptor(credentials.Seal(descriptor, SealContextOf(store)), descriptor.ProviderLabel, time.GetUtcNow());
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

    public async Task MoveInAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var selection = await SelectAsync(babyId, cancellationToken);
        await EnsureConsentAsync(selection.User, cancellationToken);
        ConfiguredStore(selection);
        throw new DataStoreMoveNotImplementedException();
    }

    public async Task MoveOutAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        await SelectAsync(babyId, cancellationToken);
        throw new DataStoreMoveNotImplementedException();
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
        if (selection.Pointer is not null || await stores.IsInUseAsync(store.Id, cancellationToken))
        {
            throw new DataStoreInUseException();
        }
    }

    /// <summary>The owner's first store (one per account in the MVP: every later save replaces its descriptor).</summary>
    private DataStore AddStore(User user)
    {
        var created = DataStore.Create(Guid.NewGuid(), user.Id, time.GetUtcNow());
        stores.Add(created);
        return created;
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
            return StoreCheckResult.Failed(StoreCheckResult.TimeoutCode);
        }
    }

    private sealed record StoreSelection(User User, Guid? Pointer, DataStore? Store);
}
