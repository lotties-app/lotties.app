using Lotties.Api.Tests.Support;
using Lotties.Application.CommunityInsights;
using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.CommunityInsights;

/// <summary>
/// <see cref="CommunityPopulation.SnapshotAsync"/>, the one population of every community run: a baby with a current consent and a
/// real Owner is eligible only when her records are settled on the built-in store (docs/design/47-bring-your-own-database.md: BYO
/// babies are excluded, fail closed while a move is unsettled). Babies of other tests share this database, so each test only looks
/// at its own baby.
/// </summary>
public sealed class CommunityPopulationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Worker = "test-worker";
    private static readonly DateTimeOffset Now = TestUsers.Now;
    private static readonly TimeSpan Lease = TimeSpan.FromMinutes(5);

    public enum StoreSituation
    {
        BuiltInNeverMoved,
        OwnDatabase,
        MovingInCopying,
        MovingInVerifying,
        MovingInCopyingWorkerGone,
        MovingOutCopying,
        MovedOutInUndoWindow,
        MovedOutCompleted,
        MoveInFailedStayedOnBuiltIn,
    }

    [Theory]
    [InlineData(StoreSituation.BuiltInNeverMoved, true)]
    [InlineData(StoreSituation.OwnDatabase, false)]
    [InlineData(StoreSituation.MovingInCopying, false)]
    [InlineData(StoreSituation.MovingInVerifying, false)]
    [InlineData(StoreSituation.MovingInCopyingWorkerGone, false)]
    [InlineData(StoreSituation.MovingOutCopying, false)]
    [InlineData(StoreSituation.MovedOutInUndoWindow, false)]
    [InlineData(StoreSituation.MovedOutCompleted, true)]
    [InlineData(StoreSituation.MoveInFailedStayedOnBuiltIn, true)]
    public async Task Snapshot_KeepsOnlyBabiesSettledOnTheBuiltInStore(StoreSituation situation, bool eligible)
    {
        var (babyId, ownerId) = await SeedConsentedBabyAsync();
        await PlaceAsync(babyId, ownerId, situation);

        var snapshot = await SnapshotAsync();

        Assert.Contains(babyId, snapshot.InForce);
        Assert.Equal(eligible, snapshot.Eligible.Contains(babyId));
    }

    [Fact]
    public async Task Snapshot_DemoOwnersBabyOnTheBuiltInStore_IsNotEligible()
    {
        var (babyId, _) = await SeedConsentedBabyAsync(User.CreateDemo(TestUsers.NewSubject(), "Demo", Now, Now.AddDays(1)));

        var snapshot = await SnapshotAsync();

        Assert.Contains(babyId, snapshot.InForce);
        Assert.DoesNotContain(babyId, snapshot.Eligible);
    }

    private async Task<CommunityPopulationSnapshot> SnapshotAsync()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await CommunityPopulation.SnapshotAsync(scope.ServiceProvider.GetRequiredService<ICommunityConsentRepository>());
    }

    private async Task<(Guid BabyId, Guid OwnerId)> SeedConsentedBabyAsync(User? owner = null)
    {
        owner ??= User.Create("https://issuer.test", TestUsers.NewSubject(), "Owner", Now);
        var baby = Baby.Create(null, DateOnly.FromDateTime(Now.UtcDateTime.AddMonths(-2)), owner.Id, Now);
        await factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Babies.Add(baby);
            context.CommunityConsents.Add(CommunityConsentEntry.Grant(baby.Id, owner.Id, CommunityConsentTexts.CurrentTextVersion, true, "test-policy", "en", Now));
            return Task.CompletedTask;
        });
        return (baby.Id, owner.Id);
    }

    /// <summary>Puts the baby's pointer and latest move where <paramref name="situation"/> says, as the move worker would leave them.</summary>
    private Task PlaceAsync(Guid babyId, Guid ownerId, StoreSituation situation) =>
        factory.SeedAsync(async context =>
        {
            if (situation == StoreSituation.BuiltInNeverMoved)
            {
                return;
            }

            var storeId = Guid.NewGuid();
            context.DataStores.Add(DataStore.Create(storeId, ownerId, Now));
            var assignment = await context.BabyStoreAssignments.SingleAsync(row => row.BabyId == babyId);
            if (situation is StoreSituation.OwnDatabase or StoreSituation.MovingOutCopying)
            {
                assignment.MoveTo(DataStoreKey.External(storeId));
            }

            if (MoveFor(babyId, storeId, situation) is { } move)
            {
                context.DataStoreMoves.Add(move);
            }
        });

    private static DataStoreMove? MoveFor(Guid babyId, Guid storeId, StoreSituation situation)
    {
        switch (situation)
        {
            case StoreSituation.MovingInCopying:
                return DataStoreMove.Start(babyId, DataStoreMoveDirection.In, storeId, Worker, Now, Lease);
            case StoreSituation.MovingInVerifying:
                var verifying = DataStoreMove.Start(babyId, DataStoreMoveDirection.In, storeId, Worker, Now, Lease);
                verifying.BeginVerify(Worker, Now, Lease);
                return verifying;
            case StoreSituation.MovingInCopyingWorkerGone:
                // The worker stopped and its lease ran out: the move still copies until a sweep resumes or gives it up.
                return DataStoreMove.Start(babyId, DataStoreMoveDirection.In, storeId, Worker, Now.AddHours(-1), TimeSpan.FromMinutes(1));
            case StoreSituation.MovingOutCopying:
                return DataStoreMove.Start(babyId, DataStoreMoveDirection.Out, storeId, Worker, Now, Lease);
            case StoreSituation.MovedOutInUndoWindow:
                return MovedOut(babyId, storeId);
            case StoreSituation.MovedOutCompleted:
                var completed = MovedOut(babyId, storeId);
                completed.OldCopyRemoved(deleted: true, Now);
                return completed;
            case StoreSituation.MoveInFailedStayedOnBuiltIn:
                var failed = DataStoreMove.Start(babyId, DataStoreMoveDirection.In, storeId, Worker, Now, Lease);
                failed.Fail("store_unavailable", leftoversPending: true, Now);
                return failed;
            default:
                return null;
        }
    }

    /// <summary>A move back to the built-in store that switched the pointer (left at the built-in store) and keeps the old copy.</summary>
    private static DataStoreMove MovedOut(Guid babyId, Guid storeId)
    {
        var move = DataStoreMove.Start(babyId, DataStoreMoveDirection.Out, storeId, Worker, Now, Lease);
        move.BeginVerify(Worker, Now, Lease);
        move.Complete(Worker, Now, TimeSpan.FromDays(7));
        return move;
    }
}
