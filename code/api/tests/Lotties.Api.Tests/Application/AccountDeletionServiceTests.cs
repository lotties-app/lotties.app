using Lotties.Api.Tests.Support;
using Lotties.Application.Stores;
using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Application;

/// <summary>
/// The account deletion recipe around the write block (docs/design/47-bring-your-own-database.md section 9, task T10): the block is
/// set before anything else changes, lifted when the deletion fails before Lotties' side is erased, and left alone once it is.
/// </summary>
public sealed class AccountDeletionServiceTests
{
    private static readonly Guid BabyId = Guid.Parse("b0000000-0000-4000-8000-0000000000d1");
    private static readonly Guid StoreId = Guid.Parse("5a000000-0000-4000-8000-0000000000d1");

    [Fact]
    public async Task DeleteAsync_ErasureFails_LiftsTheBlockAndRethrows()
    {
        var eraser = new FakeEraser { EraseFailure = new InvalidOperationException("database lost") };

        await Assert.ThrowsAsync<InvalidOperationException>(() => Service(eraser).DeleteAsync(new AccountDeletionRequest { WipeOwnDatabase = true }));

        Assert.Equal(["begin", "find", "erase", "cancel"], eraser.Steps);
    }

    [Fact]
    public async Task DeleteAsync_BlockRefused_ChangesNothingElse()
    {
        var eraser = new FakeEraser { BeginFailure = new DataStoreMoveInProgressException() };

        await Assert.ThrowsAsync<DataStoreMoveInProgressException>(() => Service(eraser).DeleteAsync(new AccountDeletionRequest { WipeOwnDatabase = true }));

        Assert.Equal(["begin"], eraser.Steps);
    }

    [Fact]
    public async Task DeleteAsync_Erased_KeepsTheBlockForTheErasedRowsAndForgetsTheStore()
    {
        var eraser = new FakeEraser();
        var health = new RecordingStoreHealth();
        var copier = new FakeCopier();

        var result = await Service(eraser, health, copier).DeleteAsync(new AccountDeletionRequest { WipeOwnDatabase = true });

        Assert.Equal(["begin", "find", "erase"], eraser.Steps);
        Assert.Equal([BabyId], result.OwnDatabaseWiped);
        Assert.Equal([BabyId], copier.Wiped);
        Assert.Equal([StoreId], health.Forgotten);
    }

    private static AccountDeletionService Service(FakeEraser eraser, RecordingStoreHealth? health = null, FakeCopier? copier = null) =>
        new(
            new FakeCurrentUser(),
            eraser,
            new OwnDatabaseWiper(copier ?? new FakeCopier(), NullLogger<OwnDatabaseWiper>.Instance),
            health ?? new RecordingStoreHealth(),
            new StoreMoveOptions { DrainSeconds = 0 },
            new NoIdentityRemover(),
            TimeProvider.System,
            NullLogger<AccountDeletionService>.Instance);

    private sealed class FakeCurrentUser : ICurrentUser
    {
        private readonly User _user = User.Create(User.UnknownIssuer, "deleting-user", "Owner", DateTimeOffset.UtcNow);

        public bool IsAuthenticated => true;

        public Task<User> GetUserAsync(CancellationToken cancellationToken = default) => Task.FromResult(_user);
    }

    private sealed class FakeEraser : IAccountDataEraser
    {
        public List<string> Steps { get; } = [];

        public Exception? BeginFailure { get; init; }

        public Exception? EraseFailure { get; init; }

        public Task<AccountDeletionPlan> PlanAsync(Guid userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new AccountDeletionPlan([new AccountDeletionBaby(BabyId, "Lia")], [], []));

        public Task<OwnStoreCopies> FindOwnStoreCopiesAsync(Guid userId, IReadOnlyCollection<Guid> babyIds, CancellationToken cancellationToken = default)
        {
            Steps.Add("find");
            return Task.FromResult(new OwnStoreCopies([new OwnStoreCopy(BabyId, StoreId)], [StoreId]));
        }

        public Task BeginDeletionAsync(IReadOnlyCollection<Guid> babyIds, DateTimeOffset now, CancellationToken cancellationToken = default)
        {
            Steps.Add("begin");
            return BeginFailure is null ? Task.CompletedTask : Task.FromException(BeginFailure);
        }

        public Task CancelDeletionAsync(IReadOnlyCollection<Guid> babyIds, CancellationToken cancellationToken = default)
        {
            Steps.Add("cancel");
            return Task.CompletedTask;
        }

        public Task EraseAsync(Guid userId, string anonymousName, DateTimeOffset now, ExternalStoreErasure externalStores, CancellationToken cancellationToken = default)
        {
            Steps.Add("erase");
            return EraseFailure is null ? Task.CompletedTask : Task.FromException(EraseFailure);
        }
    }

    private sealed class FakeCopier : IStoreRecordCopier
    {
        public List<Guid> Wiped { get; } = [];

        public Task CopyAsync(StoreCopyPlan plan, Func<StoreCopyProgress, CancellationToken, Task> onBatch, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<StoreDigest> DigestAsync(StoreCopyPlan plan, StoreCopySide side, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task WipeAsync(Guid babyId, DataStoreKey store, CancellationToken cancellationToken = default)
        {
            Wiped.Add(babyId);
            return Task.CompletedTask;
        }
    }

    private sealed class NoIdentityRemover : IIdentityAccountRemover
    {
        public bool CanRemove(string issuer) => false;

        public Task<IdentityRemoval> RemoveAsync(string issuer, string subject, CancellationToken cancellationToken = default) =>
            Task.FromResult(IdentityRemoval.NotConfigured);
    }
}
