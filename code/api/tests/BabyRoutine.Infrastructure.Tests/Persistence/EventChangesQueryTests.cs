using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Tests.Persistence;

/// <summary>The delta query must translate fully to PostgreSQL SQL (no client evaluation); checked without a database.</summary>
public sealed class EventChangesQueryTests
{
    [Fact]
    public void ChangesQuery_WithCursor_TranslatesToKeysetPredicateIncludingDeleted()
    {
        using var context = ModelTestContext.Create();
        var lastDelivered = Event.Create(Guid.NewGuid(), Guid.NewGuid(), BuiltInEventTypes.SleepId, Guid.NewGuid(), DateTimeOffset.UtcNow, null, EventPayload.Empty, null, DateTimeOffset.UtcNow);

        var sql = EfEventRepository.ChangesQuery(context, Guid.NewGuid(), EventSyncCursor.After(lastDelivered), 501).ToQueryString();

        Assert.Contains("e.updated_at > @__updatedAt", sql, StringComparison.Ordinal);
        Assert.Contains("e.id > @__eventId", sql, StringComparison.Ordinal);
        Assert.Contains("ORDER BY e.updated_at, e.id", sql, StringComparison.Ordinal);
        Assert.Contains("LIMIT @__p", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("deleted_at", sql.Split("WHERE")[1], StringComparison.Ordinal);
    }

    [Fact]
    public void ChangesQuery_WithoutCursor_FiltersByBabyOnly()
    {
        using var context = ModelTestContext.Create();

        var sql = EfEventRepository.ChangesQuery(context, Guid.NewGuid(), null, 10).ToQueryString();

        Assert.DoesNotContain("updated_at >", sql, StringComparison.Ordinal);
        Assert.Contains("e.baby_id = @__babyId", sql, StringComparison.Ordinal);
    }
}
