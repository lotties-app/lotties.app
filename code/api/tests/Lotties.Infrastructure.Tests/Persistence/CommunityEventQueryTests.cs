using Lotties.Domain.CommunityInsights;
using Lotties.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Tests.Persistence;

/// <summary>
/// The community event query (docs/design/34-community-insights.md section 5.3) translates fully to PostgreSQL SQL, checked without a
/// database: one baby, the four read type ids, a start range served by <c>(baby_id, started_at)</c>, soft-deleted events left out, and
/// only the type, the instants and the payload selected (never the notes, the author or the id).
/// </summary>
public sealed class CommunityEventQueryTests
{
    [Fact]
    public void EventsQuery_TranslatesToOneBabysLiveEventsOfTheReadTypes_SelectingNoNotes()
    {
        using var context = ModelTestContext.CreateData();
        var from = new DateTimeOffset(2026, 6, 2, 0, 0, 0, TimeSpan.Zero);

        var sql = EfCommunityEventSource.EventsQuery(context, Guid.NewGuid(), from, from.AddDays(180)).ToQueryString();

        var select = sql[sql.IndexOf("SELECT", StringComparison.Ordinal)..sql.IndexOf("FROM", StringComparison.Ordinal)];
        Assert.Contains("e.baby_id = @babyId", sql, StringComparison.Ordinal);
        Assert.Contains("e.type_id = ANY (@typeIds)", sql, StringComparison.Ordinal);
        Assert.Contains("e.started_at >= @from", sql, StringComparison.Ordinal);
        Assert.Contains("e.started_at < @before", sql, StringComparison.Ordinal);
        Assert.Contains("e.deleted_at IS NULL", sql, StringComparison.Ordinal);
        Assert.Contains("FROM events AS e", sql, StringComparison.Ordinal);
        Assert.Equal(["e.ended_at", "e.payload", "e.started_at", "e.type_id"], Columns(select));
        Assert.Equal(4, CommunityEventRows.ReadTypeIds.Count);
    }

    private static IReadOnlyList<string> Columns(string select) =>
        [.. select.Replace("SELECT", string.Empty, StringComparison.Ordinal).Split(',').Select(column => column.Trim()).Order(StringComparer.Ordinal)];
}
