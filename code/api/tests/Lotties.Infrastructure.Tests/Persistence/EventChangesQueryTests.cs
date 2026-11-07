using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>The delta query must translate fully to PostgreSQL SQL (no client evaluation); checked without a database.</summary>
public sealed class EventChangesQueryTests
{
    [Fact]
    public void ChangesQuery_WithCursor_TranslatesToKeysetPredicateIncludingDeleted()
    {
        using var context = ModelTestContext.CreateData();
        var lastDelivered = Event.Create(Guid.NewGuid(), Guid.NewGuid(), BuiltInEventTypes.SleepId, Guid.NewGuid(), DateTimeOffset.UtcNow, null, EventPayload.Empty, null, DateTimeOffset.UtcNow);

        var sql = EfEventRepository.ChangesQuery(context, Guid.NewGuid(), EventSyncCursor.After(lastDelivered), 501).ToQueryString();

        // EF Core 10 names a parameter after its variable (@updatedAt; EF Core 8 wrote @__updatedAt_0).
        Assert.Contains("e.updated_at > @updatedAt", sql, StringComparison.Ordinal);
        Assert.Contains("e.id > @eventId", sql, StringComparison.Ordinal);
        Assert.Contains("ORDER BY e.updated_at, e.id", sql, StringComparison.Ordinal);
        Assert.Contains("LIMIT @p", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("deleted_at", sql.Split("WHERE")[1], StringComparison.Ordinal);
    }

    [Fact]
    public void ChangesQuery_WithoutCursor_FiltersByBabyOnly()
    {
        using var context = ModelTestContext.CreateData();

        var sql = EfEventRepository.ChangesQuery(context, Guid.NewGuid(), null, 10).ToQueryString();

        Assert.DoesNotContain("updated_at >", sql, StringComparison.Ordinal);
        Assert.Contains("e.baby_id = @babyId", sql, StringComparison.Ordinal);
    }
}
