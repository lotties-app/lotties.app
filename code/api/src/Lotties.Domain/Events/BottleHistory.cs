using System.Text.Json;
using System.Text.Json.Nodes;

namespace Lotties.Domain.Events;

/// <summary>The pause totals a bottle's history gives (<see cref="BottleHistory.Totals"/>).</summary>
public sealed record BottleHistoryTotals(int PauseCount, int PausedSeconds);

/// <summary>
/// The history of a timed bottle (docs/design/44-bottle-history.md): its drinking stretches (<see cref="BottleSegments"/>)
/// with the time each began (<see cref="BottleSegment.Begin"/>, seconds from the feeding's start). A stretch runs from the
/// start or a resume to a pause or the stop; the pause after it lasts until the next stretch begins. The history is the
/// source of the pause totals: <see cref="Totals"/> derives <c>pause_count</c> and <c>paused_seconds</c> from it and
/// <see cref="WithTotals"/> writes them on every save (the web does the same, both read <c>bottleSegmentsVectors.json</c>).
/// A history with a stretch whose time is unknown (written before times existed) derives nothing: its totals stay as the
/// timer wrote them. Pure.
/// </summary>
public static class BottleHistory
{
    /// <summary>
    /// Why the times of <paramref name="segments"/> break the rules, or <c>null</c>: a timed first stretch begins at 0; a
    /// timed stretch begins at or after the end of the timed one before it; once the feeding ended
    /// (<paramref name="lengthSeconds"/>, its whole seconds from start to end) no timed stretch ends after the end.
    /// Stretches without a time are skipped.
    /// </summary>
    public static string? TimeProblem(IReadOnlyList<BottleSegment> segments, long? lengthSeconds)
    {
        ArgumentNullException.ThrowIfNull(segments);
        if (segments.Count > 0 && segments[0].Begin is { } first && first != 0)
        {
            return "the first stretch begins when the feeding starts (0).";
        }

        int? previousEnd = null;
        foreach (var segment in segments)
        {
            if (segment.Begin is not { } begin)
            {
                continue;
            }

            if (begin < previousEnd)
            {
                return "a stretch cannot begin before the previous one ended (times in order, pauses never overlap).";
            }

            if (segment.End > lengthSeconds)
            {
                return "a stretch cannot end after the feeding ended.";
            }

            previousEnd = segment.End;
        }

        return null;
    }

    /// <summary>
    /// The pause totals of a history where every stretch has a time and the times keep the rules, else <c>null</c>.
    /// Ended (<paramref name="lengthSeconds"/> set): the pauses between stretches, plus one more from the last stretch's
    /// end to the end when it stopped while paused. Running and <paramref name="paused"/>: the pauses between stretches
    /// (the open one is <c>paused_at</c>). Running and drinking: every stretch was followed by a pause; the last one's
    /// resume is not in the history, so its length is what <paramref name="pausedSeconds"/> says beyond the others (never
    /// below 0). Capped at the pause keys' bounds.
    /// </summary>
    public static BottleHistoryTotals? Totals(IReadOnlyList<BottleSegment> segments, long? lengthSeconds, bool paused, int pausedSeconds)
    {
        ArgumentNullException.ThrowIfNull(segments);
        if (segments.Count == 0 || segments.Any(segment => segment.Begin is null) || TimeProblem(segments, lengthSeconds) is not null)
        {
            return null;
        }

        long between = 0;
        for (var i = 1; i < segments.Count; i++)
        {
            between += segments[i].Begin!.Value - segments[i - 1].End!.Value;
        }

        var stretches = segments.Count;
        var lastEnd = segments[^1].End!.Value;
        var (count, seconds) = lengthSeconds switch
        {
            { } length when length > lastEnd => (stretches, between + (length - lastEnd)),
            { } => (stretches - 1, between),
            null when paused => (stretches - 1, between),
            null => (stretches, Math.Max(between, pausedSeconds)),
        };
        return new BottleHistoryTotals(
            (int)Math.Min(count, PauseFields.MaxPauseCount),
            (int)Math.Min(seconds, PauseFields.MaxPausedSeconds));
    }

    /// <summary>Whole seconds from <paramref name="startedAt"/> to <paramref name="endedAt"/> (never negative).</summary>
    public static long LengthSeconds(DateTimeOffset startedAt, DateTimeOffset endedAt) =>
        Math.Max(0, (long)Math.Floor((endedAt - startedAt).TotalMilliseconds / 1000));

    /// <summary>
    /// <paramref name="payload"/> with <c>pause_count</c> and <c>paused_seconds</c> recomputed from its history
    /// (<see cref="Totals"/>); unchanged when it has no timed history or the totals already agree.
    /// </summary>
    public static EventPayload WithTotals(EventPayload payload, DateTimeOffset startedAt, DateTimeOffset? endedAt)
    {
        if (JsonNode.Parse(payload.Value) is not JsonObject root
            || !root.TryGetPropertyValue(BottleSegments.Member, out var member)
            || member?.GetValueKind() != JsonValueKind.String
            || BottleSegments.TryParse(member.GetValue<string>()) is not { } segments)
        {
            return payload;
        }

        var facts = EventPayloadFacts.Read(payload);
        var length = endedAt is { } end ? LengthSeconds(startedAt, end) : (long?)null;
        var totals = Totals(segments, length, paused: endedAt is null && facts.PausedAt is not null, facts.PausedSeconds);
        if (totals is null || (totals.PauseCount == facts.PauseCount && totals.PausedSeconds == facts.PausedSeconds))
        {
            return payload;
        }

        root[PauseFields.PauseCount] = totals.PauseCount;
        root[PauseFields.PausedSeconds] = totals.PausedSeconds;
        return EventPayload.From(root.ToJsonString());
    }

    /// <summary>
    /// <paramref name="payload"/> of a bottle stopped at <paramref name="endedAt"/> while drinking (not paused), with its last
    /// drinking stretch closed as the web's stop does: it began where the last pause ended (the pause totals say when) and
    /// runs to the end, its level unknown. Without a timed history, or without drinking since, unchanged. At the cap of
    /// stretches the last one is extended and loses its time instead. Used by the assistants' stop.
    /// </summary>
    public static EventPayload ClosedAtStop(EventPayload payload, DateTimeOffset startedAt, DateTimeOffset endedAt)
    {
        if (JsonNode.Parse(payload.Value) is not JsonObject root
            || !root.TryGetPropertyValue(BottleSegments.Member, out var member)
            || member?.GetValueKind() != JsonValueKind.String
            || BottleSegments.TryParse(member.GetValue<string>()) is not { Count: > 0 } segments
            || segments.Any(segment => segment.Begin is null))
        {
            return payload;
        }

        long between = 0;
        for (var i = 1; i < segments.Count; i++)
        {
            between += segments[i].Begin!.Value - segments[i - 1].End!.Value;
        }

        var last = segments[^1];
        var resumedAt = last.End!.Value + Math.Max(0, EventPayloadFacts.Read(payload).PausedSeconds - between);
        var drinking = LengthSeconds(startedAt, endedAt) - resumedAt;
        if (drinking < 1 || resumedAt > BottleSegments.MaxSeconds)
        {
            return payload;
        }

        var seconds = (int)Math.Min(drinking, BottleSegments.MaxSeconds);
        BottleSegment[] closed = segments.Count >= BottleSegments.MaxSegments
            ? [.. segments.Take(segments.Count - 1), last with { LeftMl = null, Seconds = (int)Math.Min((long)last.Seconds + seconds, BottleSegments.MaxSeconds), Begin = null }]
            : segments.Append(new BottleSegment(last.LeftMl, null, seconds, (int)resumedAt)).ToArray();
        root[BottleSegments.Member] = BottleSegments.Format(closed);
        return EventPayload.From(root.ToJsonString());
    }

    /// <summary>
    /// Whether <paramref name="after"/> only adds to the history <paramref name="before"/>: what a pause, a level answer or
    /// the stop write (design 44 rule 7, someone else's running bottle). Every stretch of <paramref name="before"/> is
    /// still there in order with its drinking time and begin (the last one may change, a pause or the stop closes it);
    /// levels may change; more stretches may follow. Absent or unreadable before, or absent after (a stop whose amounts no
    /// level fits drops the detail): allowed.
    /// </summary>
    public static bool OnlyExtends(string? before, string? after)
    {
        var old = BottleSegments.TryParse(before);
        if (old is null || after is null)
        {
            return true;
        }

        var next = BottleSegments.TryParse(after);
        if (next is null || next.Count < old.Count)
        {
            return false;
        }

        for (var i = 0; i < old.Count - 1; i++)
        {
            if (old[i].Seconds != next[i].Seconds || old[i].Begin != next[i].Begin)
            {
                return false;
            }
        }

        return true;
    }
}
