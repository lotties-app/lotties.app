using System.Text.Json;
using Lotties.Domain.Assistants;
using Lotties.Domain.Events;

namespace Lotties.Domain.CryReasons;

/// <summary>
/// "A top-up is likely": a port of the web's <c>topUpAdjustment</c> (<c>code/web/src/events/bottlePatterns.ts</c>). The latest
/// finished feed is a bottle whose known drunk amount is under 70% of her usual amount at that part of the day (night is
/// 19:00 to 07:00 local); the next feed is then expected earlier by half of the missing share, at most 30% of her usual
/// gap. Her usual amount is the median of her known drunk amounts of the last 14 days in the same part of the day (at least
/// 3 bottles), else of all of them (at least 3); <c>null</c> with fewer. A bottle a sleep stopped without a drunk amount is
/// unknown. Facts about her own log only; never advice.
/// </summary>
public static class CryTopUp
{
    public const double PartialShare = 0.7;
    public const double MaxShare = 0.3;

    private const double Weight = 0.5;
    private const int MinimumBottles = 3;
    private const int NightFromHour = 19;
    private const int NightUntilHour = 7;
    private const double RoundingFactor = 1000;
    private static readonly TimeSpan PatternWindow = TimeSpan.FromDays(14);

    /// <param name="feedings">The baby's feeding events that are not soft deleted, in any order.</param>
    /// <param name="zone">The family's zone for the part of the day, UTC without one.</param>
    /// <returns>The share of her usual gap the next feed comes earlier, or <c>null</c> without a partial feed.</returns>
    public static double? Share(IEnumerable<Event> feedings, DateTimeOffset now, TimeZoneInfo? zone)
    {
        ArgumentNullException.ThrowIfNull(feedings);
        var feeds = feedings.Where(stored => !stored.IsDeleted).ToArray();
        var last = feeds.Where(stored => stored.StartedAt <= now).MaxBy(stored => stored.StartedAt);
        if (last is null || last.EndedAt is null || !IsBottle(last) || KnownDrunkMl(last) is not { } drunk)
        {
            return null;
        }

        if (UsualDrunkMl(feeds, last, now, zone) is not { } typical || typical <= 0 || drunk >= typical * PartialShare)
        {
            return null;
        }

        var share = Math.Min(MaxShare, (1 - (drunk / typical)) * Weight);
        return Math.Round(share * RoundingFactor, MidpointRounding.AwayFromZero) / RoundingFactor;
    }

    private static double? UsualDrunkMl(IEnumerable<Event> feeds, Event excluded, DateTimeOffset now, TimeZoneInfo? zone)
    {
        var known = feeds
            .Where(stored => stored.Id != excluded.Id && IsBottle(stored) && stored.EndedAt is not null && stored.StartedAt >= now - PatternWindow && stored.StartedAt <= now)
            .Select(stored => (Night: IsNight(stored.StartedAt, zone), Ml: KnownDrunkMl(stored)))
            .Where(entry => entry.Ml is > 0)
            .Select(entry => (entry.Night, Ml: entry.Ml!.Value))
            .ToArray();
        var samePart = known.Where(entry => entry.Night == IsNight(excluded.StartedAt, zone)).Select(entry => entry.Ml).ToArray();
        if (samePart.Length >= MinimumBottles)
        {
            return Median(samePart);
        }

        return known.Length >= MinimumBottles ? Median(known.Select(entry => entry.Ml).ToArray()) : null;
    }

    private static bool IsBottle(Event stored)
    {
        using var document = JsonDocument.Parse(stored.Payload.Value);
        return document.RootElement.ValueKind == JsonValueKind.Object
            && document.RootElement.TryGetProperty("method", out var method)
            && method.ValueKind == JsonValueKind.String
            && method.GetString() == "bottle";
    }

    /// <summary>What she drank (ml), or <c>null</c> when a sleep stopped the bottle and nobody said how much (the web's <c>knownDrunkMl</c>).</summary>
    private static double? KnownDrunkMl(Event stored)
    {
        using var document = JsonDocument.Parse(stored.Payload.Value);
        var root = document.RootElement;
        return HasUnknownFinish(root) ? null : BottleAmounts.DrunkMl(root);
    }

    private static bool HasUnknownFinish(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty(BottleAmounts.EndedByMember, out var endedBy)
            || endedBy.ValueKind != JsonValueKind.String
            || endedBy.GetString() != BottleAmounts.EndedBySleep
            || (root.TryGetProperty(BottleAmounts.DrunkMember, out var drunk) && drunk.ValueKind == JsonValueKind.Number))
        {
            return false;
        }

        var segments = root.TryGetProperty(BottleSegments.Member, out var text) && text.ValueKind == JsonValueKind.String
            ? BottleSegments.TryParse(text.GetString())
            : null;
        return segments is null || segments.Count == 0 || segments[^1].LeftMl is null;
    }

    private static bool IsNight(DateTimeOffset instant, TimeZoneInfo? zone)
    {
        var hour = (zone is null ? instant.ToUniversalTime() : TimeZoneInfo.ConvertTime(instant, zone)).Hour;
        return hour >= NightFromHour || hour < NightUntilHour;
    }

    private static double Median(double[] values)
    {
        var sorted = values.Order().ToArray();
        var middle = sorted.Length / 2;
        return sorted.Length % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }
}
