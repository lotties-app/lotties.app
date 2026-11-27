using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The secret key of the per-baby day sample (docs/design/34-community-insights.md section 5 "Per-family contribution cap"): an
/// HMAC-SHA256 key of at least <see cref="MinimumLength"/> bytes, kept stable between runs so a rerun picks the same days. Never
/// printed, serialised or logged.
/// </summary>
public sealed class CommunityCapKey
{
    /// <summary>The shortest accepted key, in bytes.</summary>
    public const int MinimumLength = 32;

    private readonly byte[] key;

    private CommunityCapKey(byte[] key) => this.key = key;

    /// <summary>A key from <paramref name="secret"/> (copied); shorter than <see cref="MinimumLength"/> bytes is refused.</summary>
    public static CommunityCapKey From(ReadOnlySpan<byte> secret)
    {
        if (secret.Length < MinimumLength)
        {
            throw new ArgumentException($"The community cap key needs at least {MinimumLength} bytes.", nameof(secret));
        }

        return new CommunityCapKey(secret.ToArray());
    }

    /// <summary>Keeps the key out of any log or exception text.</summary>
    public override string ToString() => nameof(CommunityCapKey);

    /// <summary>The keyed rank of one baby's day: HMAC-SHA256 over the baby id (big-endian) and the day number.</summary>
    internal byte[] RankOf(Guid babyId, DateOnly day)
    {
        Span<byte> message = stackalloc byte[20];
        babyId.TryWriteBytes(message, bigEndian: true, out _);
        BinaryPrimitives.WriteInt32BigEndian(message[16..], day.DayNumber);
        return HMACSHA256.HashData(key, message);
    }

    /// <summary>The keyed rank of one baby's cell (the cell bound's tie-break): HMAC-SHA256 over a marker, the baby id and the cell.</summary>
    internal byte[] RankOf(Guid babyId, CommunityCellKey cell)
    {
        var dimension = System.Text.Encoding.UTF8.GetBytes(cell.Dimension ?? string.Empty);
        var message = new byte[25 + dimension.Length];
        message[0] = 0xCE;
        babyId.TryWriteBytes(message.AsSpan(1, 16), bigEndian: true, out _);
        BinaryPrimitives.WriteInt32BigEndian(message.AsSpan(17, 4), cell.Band.FromWeeks);
        BinaryPrimitives.WriteInt32BigEndian(message.AsSpan(21, 4), cell.Band.ToWeeks);
        dimension.CopyTo(message, 25);
        return HMACSHA256.HashData(key, message);
    }
}

/// <summary>
/// The per-baby cap: per statistic and fine band, a baby contributes the observations of at most <c>capPerBaby</c> local days, the
/// days with the lowest keyed hash of her id and the day. Deterministic for a key (reruns and input order never change the pick);
/// a new day only displaces a kept day whose rank is higher.
/// </summary>
public static class CommunityDailyCap
{
    /// <summary>The kept days of one baby among <paramref name="days"/> (duplicates ignored), in day order.</summary>
    public static IReadOnlyList<DateOnly> SelectDays(Guid babyId, IEnumerable<DateOnly> days, int cap, CommunityCapKey key)
    {
        ArgumentNullException.ThrowIfNull(days);
        ArgumentNullException.ThrowIfNull(key);
        ArgumentOutOfRangeException.ThrowIfLessThan(cap, 1);
        return [.. days.Distinct()
            .Select(day => new RankedDay(day, key.RankOf(babyId, day)))
            .OrderBy(ranked => ranked.Rank, RankComparer.Instance)
            .ThenBy(ranked => ranked.Day)
            .Take(cap)
            .Select(ranked => ranked.Day)
            .Order()];
    }

    /// <summary>The samples of the kept days, per baby and fine band.</summary>
    internal static IReadOnlyList<CommunityCellSample> Apply(IEnumerable<CommunityCellSample> samples, int cap, CommunityCapKey key) =>
        [.. samples.GroupBy(sample => new BabyBand(sample.BabyId, sample.Cell.Band)).SelectMany(group => KeptSamples(group, cap, key))];

    private static IEnumerable<CommunityCellSample> KeptSamples(IGrouping<BabyBand, CommunityCellSample> group, int cap, CommunityCapKey key)
    {
        var kept = SelectDays(group.Key.BabyId, group.Select(sample => sample.Day), cap, key).ToHashSet();
        return group.Where(sample => kept.Contains(sample.Day));
    }

    private readonly record struct BabyBand(Guid BabyId, CommunityBand Band);

    private sealed record RankedDay(DateOnly Day, byte[] Rank);

    internal sealed class RankComparer : IComparer<byte[]>
    {
        public static RankComparer Instance { get; } = new();

        public int Compare(byte[]? x, byte[]? y) => x.AsSpan().SequenceCompareTo(y);
    }
}

/// <summary>
/// The cell bound of a percentile statistic (owner decision of 2026-11-27): after the day cap, one baby keeps her samples in at most
/// <c>maxCells</c> cells of the statistic per release, the cells with the most capped days, ties by a keyed rank of her id and the
/// cell. Decided from her own samples only (never another baby's), before any k or dominance decision, so the epsilon one baby
/// spends per release is at most <c>maxCells</c> times the epsilon per cell by construction.
/// </summary>
public static class CommunityCellBound
{
    /// <summary>The cells one baby keeps among those she has capped days in (<paramref name="daysPerCell"/>), in rank order.</summary>
    public static IReadOnlyList<CommunityCellKey> SelectCells(Guid babyId, IReadOnlyDictionary<CommunityCellKey, int> daysPerCell, int maxCells, CommunityCapKey key)
    {
        ArgumentNullException.ThrowIfNull(daysPerCell);
        ArgumentNullException.ThrowIfNull(key);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxCells, 1);
        return [.. daysPerCell
            .OrderByDescending(cell => cell.Value)
            .ThenBy(cell => key.RankOf(babyId, cell.Key), CommunityDailyCap.RankComparer.Instance)
            .Take(maxCells)
            .Select(cell => cell.Key)];
    }

    /// <summary>The samples of the kept cells, per baby.</summary>
    internal static IReadOnlyList<CommunityCellSample> Apply(IEnumerable<CommunityCellSample> samples, int maxCells, CommunityCapKey key) =>
        [.. samples.GroupBy(sample => sample.BabyId).SelectMany(baby => KeptSamples(baby, maxCells, key))];

    private static IEnumerable<CommunityCellSample> KeptSamples(IGrouping<Guid, CommunityCellSample> baby, int maxCells, CommunityCapKey key)
    {
        var daysPerCell = baby.GroupBy(sample => sample.Cell).ToDictionary(cell => cell.Key, cell => cell.Select(sample => sample.Day).Distinct().Count());
        var kept = SelectCells(baby.Key, daysPerCell, maxCells, key).ToHashSet();
        return baby.Where(sample => kept.Contains(sample.Cell));
    }
}
