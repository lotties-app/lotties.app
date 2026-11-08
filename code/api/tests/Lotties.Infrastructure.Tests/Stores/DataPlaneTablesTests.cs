using Lotties.Application.Stores;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Notes;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores.Moves;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// The table list of a store move (task T7): every data table exactly once, references before the rows that point at them, and the
/// verification digest independent of the order a database returns rows in; plus the move settings' ranges.
/// </summary>
public sealed class DataPlaneTablesTests
{
    [Fact]
    public void InCopyOrder_HoldsEveryDataTableOnce()
    {
        var listed = DataPlaneTables.InCopyOrder.Select(table => table.EntityType).ToArray();

        Assert.Equal(DataPlane.EntityTypes.Count, listed.Length);
        Assert.Equal(DataPlane.EntityTypes.OrderBy(type => type.Name), listed.OrderBy(type => type.Name));
        Assert.Equal(listed.Length, DataPlaneTables.InCopyOrder.Select(table => table.Name).Distinct().Count());
    }

    [Fact]
    public void InCopyOrder_EveryForeignKeyInsideTheDataPlane_PointsAtAnEarlierTable()
    {
        using var context = ModelTestContext.CreateData();
        var position = DataPlaneTables.InCopyOrder.Select((table, index) => (table.EntityType, index)).ToDictionary(pair => pair.EntityType, pair => pair.index);

        var late = context.Model.GetEntityTypes()
            .Where(entity => !entity.IsOwned())
            .SelectMany(entity => entity.GetForeignKeys().Select(key => (Dependent: entity.ClrType, Principal: key.PrincipalEntityType.ClrType)))
            .Where(link => position.ContainsKey(link.Principal) && link.Principal != link.Dependent)
            .Where(link => position[link.Principal] >= position[link.Dependent])
            .ToArray();

        Assert.Empty(late);
        Assert.True(position[typeof(EventType)] < position[typeof(Event)]);
        Assert.True(position[typeof(BabyNote)] < position[typeof(NoteRead)]);
    }

    [Fact]
    public void Digest_SameRowsInAnyOrder_IsTheSame_AndAnyChangedStampIsNot()
    {
        var first = new RowStamp { Key = Guid.Parse("00000000-0000-4000-8000-000000000001"), ChangedAt = DateTimeOffset.UnixEpoch };
        var second = new RowStamp { Key = Guid.Parse("00000000-0000-4000-8000-000000000002"), ChangedAt = DateTimeOffset.UnixEpoch, DeletedAt = DateTimeOffset.UnixEpoch };
        var edited = new RowStamp { Key = second.Key, ChangedAt = DateTimeOffset.UnixEpoch.AddTicks(10), DeletedAt = second.DeletedAt };

        var digest = StoreRecordCopier.Digest("events", [first, second]);

        Assert.Equal(digest, StoreRecordCopier.Digest("events", [second, first]));
        Assert.Equal(2, digest.Count);
        Assert.Equal(64, digest.Checksum.Length);
        Assert.NotEqual(digest, StoreRecordCopier.Digest("events", [first, edited]));
        Assert.NotEqual(digest, StoreRecordCopier.Digest("events", [first]));
        Assert.Equal(StoreRecordCopier.Digest("events", []).Checksum, StoreRecordCopier.Digest("events", []).Checksum);
    }

    [Fact]
    public void Options_Defaults_AreValid()
    {
        Assert.True(new StoreMoveOptionsValidator().Validate(null, new StoreMoveOptions()).Succeeded);
    }

    [Theory]
    [InlineData(nameof(StoreMoveOptions.BatchSize), 10)]
    [InlineData(nameof(StoreMoveOptions.UndoWindowDays), 91)]
    [InlineData(nameof(StoreMoveOptions.DrainSeconds), 121)]
    [InlineData(nameof(StoreMoveOptions.LeaseSeconds), 10)]
    [InlineData(nameof(StoreMoveOptions.SweepSeconds), 1)]
    [InlineData(nameof(StoreMoveOptions.MaxAttempts), 0)]
    [InlineData(nameof(StoreMoveOptions.CleanupRetryMinutes), 0)]
    public void Options_OutOfRange_FailStartup(string setting, int value)
    {
        var options = new StoreMoveOptions();
        typeof(StoreMoveOptions).GetProperty(setting)!.SetValue(options, value);

        var result = new StoreMoveOptionsValidator().Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains(setting, result.FailureMessage, StringComparison.Ordinal);
    }

    [Fact]
    public void Options_LeaseNotLongerThanTwiceTheDrain_FailsStartup()
    {
        var result = new StoreMoveOptionsValidator().Validate(null, new StoreMoveOptions { DrainSeconds = 60, LeaseSeconds = 100 });

        Assert.True(result.Failed);
    }

    [Fact]
    public void Options_ZeroUndoWindow_IsAllowed()
    {
        Assert.True(new StoreMoveOptionsValidator().Validate(null, new StoreMoveOptions { UndoWindowDays = 0 }).Succeeded);
        Assert.IsAssignableFrom<IValidateOptions<StoreMoveOptions>>(new StoreMoveOptionsValidator());
    }
}
