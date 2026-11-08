using Lotties.Domain.Exceptions;
using Lotties.Domain.Users;

namespace Lotties.Domain.Tests.Users;

/// <summary>The plan of an account deletion and what it finds in the user's own databases (design 47 section 9, task T10).</summary>
public sealed class AccountDeletionPlanTests
{
    private static readonly Guid BabyA = Guid.Parse("b0000000-0000-4000-8000-00000000000a");
    private static readonly Guid BabyB = Guid.Parse("b0000000-0000-4000-8000-00000000000b");
    private static readonly Guid Store = Guid.Parse("5a000000-0000-4000-8000-000000000001");

    [Fact]
    public void EnsureNotBlocked_WithABlockedBaby_ThrowsWithItsId()
    {
        var plan = new AccountDeletionPlan([new AccountDeletionBaby(BabyA, "Lia")], [], [new AccountDeletionBaby(BabyB, "Noah")]);

        var refused = Assert.Throws<AccountDeletionBlockedException>(plan.EnsureNotBlocked);

        Assert.Equal([BabyB], refused.BabyIds);
        Assert.Equal([BabyA], plan.DeletedIds);
    }

    [Fact]
    public void EnsureNotBlocked_NothingBlocked_DoesNotThrow()
    {
        new AccountDeletionPlan([new AccountDeletionBaby(BabyA, "Lia")], [], []).EnsureNotBlocked();
    }

    [Fact]
    public void OwnStoreCopies_SameBabyTwice_IsNamedOnce()
    {
        var copies = new OwnStoreCopies([new OwnStoreCopy(BabyA, Store), new OwnStoreCopy(BabyA, Guid.NewGuid()), new OwnStoreCopy(BabyB, Store)], [Store], []);

        Assert.Equal([BabyA, BabyB], copies.BabyIds);
        copies.EnsureNoMoveRunning();
    }

    [Fact]
    public void EnsureNoMoveRunning_AMoveRuns_ThrowsMoveInProgress()
    {
        var copies = new OwnStoreCopies([], [Store], [BabyA]);

        Assert.Throws<DataStoreMoveInProgressException>(copies.EnsureNoMoveRunning);
    }
}
