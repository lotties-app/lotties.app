using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Events;

/// <summary>
/// One drinking stretch of a timed bottle (docs/design/20-feeding-amounts.md section 5): from the start or a resume to the
/// next pause or the stop. <see cref="StartMl"/> is the level in the bottle when it began (the prepared amount for the
/// first one), <see cref="LeftMl"/> the level when it ended; either may be unknown (<c>null</c>: the parent skipped the
/// question). <see cref="Seconds"/> is its drinking time (pauses excluded). <see cref="Begin"/> (docs/design/44-bottle-history.md)
/// is when it began, in whole seconds from the feeding's start (<c>null</c>: time unknown, a bottle written before the
/// history had times); it ends at <see cref="End"/>, and the pause after it lasts until the next stretch begins.
/// </summary>
public sealed record BottleSegment(int? StartMl, int? LeftMl, int Seconds, int? Begin = null)
{
    /// <summary>What the baby drank in this stretch (ml), when both levels are known.</summary>
    public int? DrunkMl => StartMl is { } start && LeftMl is { } left ? start - left : null;

    /// <summary>When it ended (seconds from the feeding's start), when its begin is known.</summary>
    public int? End => Begin is { } begin ? begin + Seconds : null;
}

/// <summary>
/// The hidden built-in feeding member <c>segments</c>: the drinking stretches of a timed bottle, as compact text
/// <c>start&gt;left@seconds</c> per stretch, optionally followed by <c>+begin</c> (when it began, seconds from the feeding's
/// start, docs/design/44-bottle-history.md), joined by <c>;</c> (e.g. <c>120&gt;80@360+0;80&gt;15@780+540</c>), where a
/// level is whole ml (0 to <see cref="MaxLevelMl"/>) or <c>?</c> (unknown) and seconds and begin whole numbers (0 to
/// <see cref="MaxSeconds"/>). Text because the field kinds have no list; the web parses the same grammar
/// (<c>code/web/src/events/bottleSegments.ts</c>) and both read the shared vectors <c>bottleSegmentsVectors.json</c>.
/// The total <c>amount_drunk_ml</c> stays the single source of every total: the segments only add detail.
/// </summary>
public static partial class BottleSegments
{
    public const string Member = "segments";
    public const int MaxSegments = 20;
    public const int MaxLength = 480;
    public const int MaxLevelMl = 2000;
    public const int MaxSeconds = 86_400;

    private const char Separator = ';';
    private const string UnknownLevel = "?";

    /// <summary>The stretches of <paramref name="text"/>, or <c>null</c> when it breaks the grammar or the bounds.</summary>
    public static IReadOnlyList<BottleSegment>? TryParse(string? text)
    {
        if (string.IsNullOrEmpty(text) || text.Length > MaxLength)
        {
            return null;
        }

        var parts = text.Split(Separator);
        if (parts.Length > MaxSegments)
        {
            return null;
        }

        var segments = new List<BottleSegment>(parts.Length);
        foreach (var part in parts)
        {
            if (ParseOne(part) is not { } segment)
            {
                return null;
            }

            segments.Add(segment);
        }

        return segments.AsReadOnly();
    }

    /// <summary>
    /// Throws <see cref="DomainValidationException"/> (field <c>segments</c>) when the payload's <c>segments</c> text is
    /// malformed or disagrees with the amounts: a stretch ends above its start; a stretch does not start at the level
    /// the previous one ended at (both known and equal, or both unknown); a known level is above <c>amount_ml</c>; what
    /// the known levels say was drunk (<c>amount_ml</c> minus the last known level) is above the drunk total
    /// (<c>amount_drunk_ml</c>, absent = all of <c>amount_ml</c>); or, once the feeding ended, the last stretch's known
    /// end level disagrees with the total (<c>amount_ml - left = total</c>). Absent or <c>null</c>: nothing to check (old
    /// bottles, bottles never paused). A value that is not text is left to the field rules.
    /// </summary>
    /// <remarks>
    /// With times (<see cref="BottleSegment.Begin"/>, design 44 section 4): a timed first stretch begins at 0, a timed
    /// stretch begins at or after the end of the timed one before it (pauses in order, never overlapping) and, once the
    /// feeding ended (<paramref name="lengthSeconds"/>: its whole seconds from start to end), no timed stretch ends after
    /// the end. Stretches without a time are skipped by these checks.
    /// </remarks>
    public static void EnsureValid(EventPayload payload, bool ended, long? lengthSeconds = null)
    {
        using var document = JsonDocument.Parse(payload.Value);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty(Member, out var member)
            || member.ValueKind != JsonValueKind.String)
        {
            return;
        }

        var segments = TryParse(member.GetString())
            ?? throw Invalid($"'{Member}' must be 1 to {MaxSegments} stretches 'start>left@seconds' or 'start>left@seconds+begin' joined by ';' (levels whole ml or '?').");
        EnsureChain(segments);
        if (BottleHistory.TimeProblem(segments, ended ? lengthSeconds : null) is { } problem)
        {
            throw Invalid($"'{Member}': {problem}");
        }

        EnsureAmounts(segments, Amount(root, BottleAmounts.PreparedMember), Amount(root, BottleAmounts.DrunkMember), ended);
    }

    private static void EnsureChain(IReadOnlyList<BottleSegment> segments)
    {
        for (var i = 0; i < segments.Count; i++)
        {
            var segment = segments[i];
            if (segment.DrunkMl is < 0)
            {
                throw Invalid($"'{Member}': a stretch cannot end above the level it started at.");
            }

            if (i > 0 && segment.StartMl != segments[i - 1].LeftMl)
            {
                throw Invalid($"'{Member}': a stretch must start at the level the previous one ended at.");
            }
        }
    }

    private static void EnsureAmounts(IReadOnlyList<BottleSegment> segments, double? prepared, double? drunk, bool ended)
    {
        if (prepared is not { } made)
        {
            return;
        }

        if (Levels(segments).Any(level => level > made))
        {
            throw Invalid($"'{Member}': a level cannot be above {BottleAmounts.PreparedMember}.");
        }

        var total = drunk is { } drank ? Math.Min(drank, made) : made;
        if (Levels(segments).LastOrDefault() is { } lastKnown && made - lastKnown > total)
        {
            throw Invalid($"'{Member}': the levels say more was drunk than {BottleAmounts.DrunkMember}.");
        }

        if (ended && segments[^1].LeftMl is { } left && made - left != total)
        {
            throw Invalid($"'{Member}': the level left at the end must match {BottleAmounts.DrunkMember}.");
        }
    }

    /// <summary>The text form of <paramref name="segments"/> (the caller keeps them within the bounds).</summary>
    public static string Format(IEnumerable<BottleSegment> segments) =>
        string.Join(Separator, segments.Select(segment =>
            string.Create(CultureInfo.InvariantCulture, $"{LevelText(segment.StartMl)}>{LevelText(segment.LeftMl)}@{segment.Seconds}")
            + (segment.Begin is { } begin ? string.Create(CultureInfo.InvariantCulture, $"+{begin}") : string.Empty)));

    private static string LevelText(int? level) =>
        level is { } value ? value.ToString(CultureInfo.InvariantCulture) : UnknownLevel;

    /// <summary>The known levels in time order: the first start, then every end.</summary>
    private static IEnumerable<int?> Levels(IReadOnlyList<BottleSegment> segments) =>
        segments.Take(1).Select(segment => segment.StartMl)
            .Concat(segments.Select(segment => segment.LeftMl))
            .Where(level => level is not null);

    private static BottleSegment? ParseOne(string part)
    {
        var match = SegmentPattern().Match(part);
        if (!match.Success)
        {
            return null;
        }

        var seconds = int.Parse(match.Groups["seconds"].Value, NumberStyles.None, CultureInfo.InvariantCulture);
        int? begin = match.Groups["begin"].Success
            ? int.Parse(match.Groups["begin"].Value, NumberStyles.None, CultureInfo.InvariantCulture)
            : null;
        if (seconds > MaxSeconds
            || begin > MaxSeconds
            || !TryLevel(match.Groups["start"].Value, out var start)
            || !TryLevel(match.Groups["left"].Value, out var left))
        {
            return null;
        }

        return new BottleSegment(start, left, seconds, begin);
    }

    private static bool TryLevel(string text, out int? level)
    {
        level = null;
        if (text == UnknownLevel)
        {
            return true;
        }

        var value = int.Parse(text, NumberStyles.None, CultureInfo.InvariantCulture);
        level = value;
        return value <= MaxLevelMl;
    }

    private static double? Amount(JsonElement root, string key) =>
        root.TryGetProperty(key, out var member)
        && member.ValueKind == JsonValueKind.Number
        && member.TryGetDouble(out var value)
        && double.IsFinite(value)
        && value >= 0
            ? value
            : null;

    private static DomainValidationException Invalid(string message) => new(Member, message);

    [GeneratedRegex(@"^(?<start>\?|0|[1-9][0-9]{0,3})>(?<left>\?|0|[1-9][0-9]{0,3})@(?<seconds>0|[1-9][0-9]{0,4})(?:\+(?<begin>0|[1-9][0-9]{0,4}))?\z", RegexOptions.CultureInvariant)]
    private static partial Regex SegmentPattern();
}
