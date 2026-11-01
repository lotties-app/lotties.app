using System.Text.Json;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Assistants;

/// <summary>What a feeding was, as an assistant answer tells it.</summary>
/// <param name="AmountMl">A bottle's drunk amount, else its prepared amount (whole ml); <c>null</c> without one.</param>
/// <param name="Side">A nursing session's last side (<c>last_side</c>, else <c>side</c>).</param>
/// <param name="FormulaName">The formula a bottle names (its <c>formula_name</c> snapshot).</param>
public sealed record FeedFact(FeedMethod Method, int? AmountMl, BreastSide? Side, BottleKind BottleKind, string? FormulaName);

/// <summary>
/// Reads the events the assistant commands act on, leniently (stored payloads may predate any rule), with the web app's
/// rules for the same actions: a sleep timer is a sleep event of kind <c>nap</c>, <c>night</c> or none (the web's
/// stoppable kinds); a sleep that starts is a night when a bed time was logged in the last
/// <see cref="BedTimeWindow"/> or the local hour is from 19:00 to 04:59 (web <c>inferFellAsleepKind</c>), else a nap; a
/// nursing session starts on the side opposite to where the last finished one ended, else left (web
/// <c>suggestedStartSide</c>).
/// </summary>
public static class AssistantEventFacts
{
    /// <summary>How recent a bed time makes the next sleep a night (web <c>BEDTIME_WINDOW_MS</c>).</summary>
    public static readonly TimeSpan BedTimeWindow = TimeSpan.FromHours(3);

    private const int NightFromHour = 19;
    private const int NightUntilHour = 5;

    public static bool IsSleepTimer(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        var kind = EventPayloadFacts.Read(stored.Payload).Kind;
        return stored.TypeId == BuiltInEventTypes.SleepId && kind is null or SleepKinds.Nap or SleepKinds.Night;
    }

    public static bool IsRunningSleepTimer(Event stored) => stored.IsRunning && IsSleepTimer(stored);

    public static bool IsRunningNightWaking(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        return stored.IsRunning && stored.TypeId == BuiltInEventTypes.SleepId && EventPayloadFacts.Read(stored.Payload).Kind == SleepKinds.NightWaking;
    }

    public static bool IsRunningNursing(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        return stored.IsRunning && stored.TypeId == BuiltInEventTypes.FeedingId && ReadFeed(stored).Method == FeedMethod.Breast;
    }

    /// <summary>The kind of a sleep starting at <paramref name="now"/>: <c>night</c> or <c>nap</c> (see the class remarks); without a zone only a bed time makes it a night.</summary>
    public static string SleepKindAt(IEnumerable<Event> recentSleepEvents, DateTimeOffset now, TimeZoneInfo? zone)
    {
        ArgumentNullException.ThrowIfNull(recentSleepEvents);
        var bedTimeLogged = recentSleepEvents.Any(stored => IsRecentBedTime(stored, now));
        return bedTimeLogged || IsNightHour(now, zone) ? SleepKinds.Night : SleepKinds.Nap;
    }

    /// <summary>The side a new nursing session starts on: opposite to where the newest finished one ended, else left.</summary>
    public static BreastSide SuggestedNursingSide(IEnumerable<Event> recentFeedings)
    {
        ArgumentNullException.ThrowIfNull(recentFeedings);
        var last = recentFeedings
            .Where(stored => !stored.IsDeleted && stored.EndedAt is not null && stored.TypeId == BuiltInEventTypes.FeedingId)
            .Select(stored => (stored.StartedAt, Feed: ReadFeed(stored)))
            .Where(entry => entry.Feed.Method == FeedMethod.Breast)
            .OrderByDescending(entry => entry.StartedAt)
            .Select(entry => entry.Feed.Side)
            .FirstOrDefault();
        return last == BreastSide.Left ? BreastSide.Right : BreastSide.Left;
    }

    public static FeedFact ReadFeed(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        using var document = JsonDocument.Parse(stored.Payload.Value);
        var root = document.RootElement;
        return root.ValueKind != JsonValueKind.Object
            ? new FeedFact(FeedMethod.Unknown, null, null, BottleKind.Unspecified, null)
            : new FeedFact(
                MethodOf(Text(root, "method")),
                AmountOf(root),
                SideOf(Text(root, AssistantPayloads.LastSideMember)) ?? SideOf(Text(root, "side")),
                BottleKindOf(Text(root, "bottle_feeding_type")),
                Text(root, FormulaPayload.FormulaNameMember));
    }

    /// <summary>The content of a diaper event (<c>WET</c>, <c>DIRTY</c>, <c>MIXED</c>, any case); <c>null</c> when it has none.</summary>
    public static DiaperKind? DiaperKindOf(Event stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        var content = EventPayloadFacts.Read(stored.Payload).Content;
        return (DiaperContents.IsWet(content), DiaperContents.IsDirty(content)) switch
        {
            (true, true) => DiaperKind.Both,
            (true, false) => DiaperKind.Wet,
            (false, true) => DiaperKind.Dirty,
            _ => null,
        };
    }

    private static bool IsRecentBedTime(Event stored, DateTimeOffset now) =>
        !stored.IsDeleted
        && stored.TypeId == BuiltInEventTypes.SleepId
        && stored.StartedAt <= now
        && stored.StartedAt >= now - BedTimeWindow
        && EventPayloadFacts.Read(stored.Payload).Kind == SleepKinds.BedTime;

    private static bool IsNightHour(DateTimeOffset now, TimeZoneInfo? zone) =>
        zone is not null && TimeZoneInfo.ConvertTime(now, zone).Hour is >= NightFromHour or < NightUntilHour;

    private static FeedMethod MethodOf(string? method) => method switch
    {
        "breast" => FeedMethod.Breast,
        "bottle" => FeedMethod.Bottle,
        "solid" => FeedMethod.Solid,
        _ => FeedMethod.Unknown,
    };

    private static BreastSide? SideOf(string? side) => side switch
    {
        "left" => BreastSide.Left,
        "right" => BreastSide.Right,
        _ => null,
    };

    private static BottleKind BottleKindOf(string? kind) => kind switch
    {
        "formula" => BottleKind.Formula,
        "breast_milk" => BottleKind.BreastMilk,
        _ => BottleKind.Unspecified,
    };

    /// <summary>The drunk amount, whole ml (<see cref="BottleAmounts.DrunkMl"/>, the web's <c>drunkMl</c>).</summary>
    private static int? AmountOf(JsonElement root) =>
        BottleAmounts.DrunkMl(root) is { } value ? (int)Math.Round(value, MidpointRounding.AwayFromZero) : null;

    private static string? Text(JsonElement root, string key) =>
        root.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
