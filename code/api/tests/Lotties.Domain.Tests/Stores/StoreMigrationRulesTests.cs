using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

/// <summary>
/// The pure rules of the store migrator (docs/design/47-bring-your-own-database.md section 4, task T5): the state machine of a
/// store, the schema comparison that detects a store migrated by a newer API, the backoff and the app role audit.
/// </summary>
public sealed class StoreMigrationRulesTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 7, 12, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(DataStoreState.Pending, DataStoreState.Migrating)]
    [InlineData(DataStoreState.Pending, DataStoreState.Ready)]
    [InlineData(DataStoreState.Pending, DataStoreState.RoleTooPowerful)]
    [InlineData(DataStoreState.Migrating, DataStoreState.Ready)]
    [InlineData(DataStoreState.Migrating, DataStoreState.MigrationFailed)]
    [InlineData(DataStoreState.Ready, DataStoreState.Migrating)]
    [InlineData(DataStoreState.Ready, DataStoreState.SchemaAhead)]
    [InlineData(DataStoreState.MigrationFailed, DataStoreState.Migrating)]
    [InlineData(DataStoreState.SchemaAhead, DataStoreState.Ready)]
    [InlineData(DataStoreState.RoleTooPowerful, DataStoreState.Ready)]
    [InlineData(DataStoreState.Unreachable, DataStoreState.Migrating)]
    [InlineData(DataStoreState.SchemaConflict, DataStoreState.Ready)]
    [InlineData(DataStoreState.Disabled, DataStoreState.Disabled)]
    public void CanMove_MigratorOutcomes_AreAllowed(DataStoreState from, DataStoreState to) =>
        Assert.True(DataStoreStateTransitions.CanMove(from, to));

    [Theory]
    [InlineData(DataStoreState.Ready, DataStoreState.Pending)]
    [InlineData(DataStoreState.Migrating, DataStoreState.Pending)]
    [InlineData(DataStoreState.Ready, DataStoreState.Disabled)]
    [InlineData(DataStoreState.Disabled, DataStoreState.Ready)]
    [InlineData(DataStoreState.Disabled, DataStoreState.Migrating)]
    public void CanMove_BackToPendingOrAroundDisabled_IsRefused(DataStoreState from, DataStoreState to) =>
        Assert.False(DataStoreStateTransitions.CanMove(from, to));

    [Fact]
    public void Serves_OnlyReady()
    {
        Assert.Equal([DataStoreState.Ready], Enum.GetValues<DataStoreState>().Where(DataStoreStateTransitions.Serves));
    }

    [Fact]
    public void StateNames_FitTheStateColumns()
    {
        Assert.All(Enum.GetNames<DataStoreState>(), name => Assert.True(name.Length <= 32, name));
    }

    [Fact]
    public void RecordMigrationState_MovesTheStateAndKeepsTheVersionWhenNoneIsGiven()
    {
        var store = DataStore.Create(Guid.NewGuid(), Guid.NewGuid(), Now);

        store.RecordMigrationState(DataStoreState.Migrating, null, Now.AddSeconds(1));
        store.RecordMigrationState(DataStoreState.Ready, "20261107000000_DataBaseline", Now.AddSeconds(2));
        store.RecordMigrationState(DataStoreState.Unreachable, null, Now.AddSeconds(3));

        Assert.Equal((DataStoreState.Unreachable, "20261107000000_DataBaseline", Now.AddSeconds(3)), (store.State, store.SchemaVersion, store.UpdatedAt));
        Assert.Equal(Now, store.CreatedAt);
    }

    [Fact]
    public void RecordMigrationState_RefusedMove_ThrowsAndChangesNothing()
    {
        var store = DataStore.Create(Guid.NewGuid(), Guid.NewGuid(), Now);
        store.RecordMigrationState(DataStoreState.Ready, "v1", Now.AddSeconds(1));

        var error = Assert.Throws<DataStoreStateTransitionException>(() => store.RecordMigrationState(DataStoreState.Pending, "v2", Now.AddSeconds(2)));

        Assert.Equal(("store_state_transition", DataStoreState.Ready, DataStoreState.Pending), (error.Code, error.From, error.To));
        Assert.Equal((DataStoreState.Ready, "v1", Now.AddSeconds(1)), (store.State, store.SchemaVersion, store.UpdatedAt));
    }

    [Fact]
    public void Compare_EmptyStore_IsBehindWithEveryKnownMigrationPending()
    {
        var status = StoreSchemaStatus.Compare([], ["2_Second", "1_First"]);

        Assert.Equal(StoreSchemaPosition.Behind, status.Position);
        Assert.Equal(["1_First", "2_Second"], status.Pending);
        Assert.Empty(status.Unknown);
        Assert.Null(status.LatestApplied);
    }

    [Fact]
    public void Compare_EverythingApplied_IsUpToDate()
    {
        var status = StoreSchemaStatus.Compare(["1_First", "2_Second"], ["1_First", "2_Second"]);

        Assert.Equal((StoreSchemaPosition.UpToDate, "2_Second"), (status.Position, status.LatestApplied));
        Assert.Empty(status.Pending);
    }

    [Fact]
    public void Compare_PartlyApplied_IsBehindWithTheRest()
    {
        var status = StoreSchemaStatus.Compare(["1_First"], ["1_First", "2_Second", "3_Third"]);

        Assert.Equal(StoreSchemaPosition.Behind, status.Position);
        Assert.Equal(["2_Second", "3_Third"], status.Pending);
    }

    [Fact]
    public void Compare_AnAppliedMigrationThisApiDoesNotKnow_IsAheadEvenWithOthersPending()
    {
        var status = StoreSchemaStatus.Compare(["1_First", "9_FromTheFuture"], ["1_First", "2_Second"]);

        Assert.Equal(StoreSchemaPosition.Ahead, status.Position);
        Assert.Equal(["9_FromTheFuture"], status.Unknown);
        Assert.Equal("9_FromTheFuture", status.LatestApplied);
    }

    [Fact]
    public void DelayFor_DoublesFromTheInitialDelayUpToTheCap()
    {
        var backoff = new StoreBackoff(TimeSpan.FromMilliseconds(50), TimeSpan.FromMilliseconds(1000), 0.2);

        var delays = Enumerable.Range(1, 7).Select(attempt => backoff.DelayFor(attempt, 0).TotalMilliseconds);

        Assert.Equal([50d, 100d, 200d, 400d, 800d, 1000d, 1000d], delays);
        Assert.Equal(TimeSpan.FromMilliseconds(1000), backoff.DelayFor(int.MaxValue, 0));
    }

    [Fact]
    public void DelayFor_JitterShortensTheDelayByAtMostItsFraction()
    {
        var backoff = new StoreBackoff(TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10), 0.2);

        Assert.Equal(TimeSpan.FromSeconds(9), backoff.DelayFor(1, 0.5));
        Assert.True(backoff.DelayFor(1, 0.999999) > TimeSpan.FromSeconds(8));
    }

    [Fact]
    public void Backoff_InvalidSettingsAndDraws_Throw()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new StoreBackoff(TimeSpan.Zero, TimeSpan.FromSeconds(1), 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new StoreBackoff(TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(1), 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => new StoreBackoff(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1), 1.5));
        var backoff = new StoreBackoff(TimeSpan.FromSeconds(1), TimeSpan.FromSeconds(1), 0);
        Assert.Throws<ArgumentOutOfRangeException>(() => backoff.DelayFor(0, 0));
        Assert.Throws<ArgumentOutOfRangeException>(() => backoff.DelayFor(1, 1));
    }

    [Fact]
    public void RoleAudit_NoFlag_IsLeastPrivilege()
    {
        var audit = StoreRoleAudit.From(false, false, false, false);

        Assert.False(audit.IsTooPowerful);
        Assert.Empty(audit.Findings);
        Assert.False(StoreRoleAudit.LeastPrivilege.IsTooPowerful);
    }

    [Fact]
    public void RoleAudit_EachFlag_IsAFinding()
    {
        Assert.Equal([StoreRoleFinding.SuperuserLike], StoreRoleAudit.From(true, false, false, false).Findings);
        Assert.Equal([StoreRoleFinding.OwnsObjects], StoreRoleAudit.From(false, true, false, false).Findings);
        Assert.Equal([StoreRoleFinding.CreatesInPublic], StoreRoleAudit.From(false, false, true, false).Findings);
        Assert.Equal([StoreRoleFinding.CreatesInStoreSchema], StoreRoleAudit.From(false, false, false, true).Findings);
        Assert.True(StoreRoleAudit.From(true, true, true, true).IsTooPowerful);
    }
}
