namespace Lotties.Domain.AgeNorms;

/// <summary>
/// The published age norms of <c>code/api/data/age-norms.json</c> (schema 1, docs/design/28-age-norms.md): cited ranges by
/// age for sleep, feeding, diapers, crying and meals. Facts only: they seed or bound a prediction until the baby's own log
/// has enough data, and the app never tells a family that a baby is inside or outside a norm. Only a norm that
/// <see cref="AgeNorm.IsUsableAsPrior"/> may replace a default (<see cref="PriorFor"/>); a low-confidence norm or one that
/// needs review stays documentation.
/// </summary>
public sealed class AgeNormSet
{
    /// <summary>The schema version this code reads.</summary>
    public const int SupportedSchemaVersion = 1;

    private readonly IReadOnlyDictionary<string, AgeNorm[]> _normsByMetricAndPopulation;

    public AgeNormSet(
        int schemaVersion,
        DateOnly generatedAt,
        string purpose,
        IReadOnlyList<string> units,
        IReadOnlyList<string> populations,
        IReadOnlyList<string> rangeKinds,
        IReadOnlyList<string> typicalKinds,
        IReadOnlyList<AgeNormMetric> metrics,
        IReadOnlyList<AgeNormSource> sources,
        IReadOnlyList<AgeNorm> norms)
    {
        SchemaVersion = schemaVersion;
        GeneratedAt = generatedAt;
        Purpose = purpose ?? throw new ArgumentNullException(nameof(purpose));
        Units = units ?? throw new ArgumentNullException(nameof(units));
        Populations = populations ?? throw new ArgumentNullException(nameof(populations));
        RangeKinds = rangeKinds ?? throw new ArgumentNullException(nameof(rangeKinds));
        TypicalKinds = typicalKinds ?? throw new ArgumentNullException(nameof(typicalKinds));
        Metrics = metrics ?? throw new ArgumentNullException(nameof(metrics));
        Sources = sources ?? throw new ArgumentNullException(nameof(sources));
        Norms = norms ?? throw new ArgumentNullException(nameof(norms));
        _normsByMetricAndPopulation = norms
            .GroupBy(norm => Key(norm.Metric, norm.Population), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.ToArray(), StringComparer.Ordinal);
    }

    public int SchemaVersion { get; }

    public DateOnly GeneratedAt { get; }

    public string Purpose { get; }

    public IReadOnlyList<string> Units { get; }

    public IReadOnlyList<string> Populations { get; }

    public IReadOnlyList<string> RangeKinds { get; }

    public IReadOnlyList<string> TypicalKinds { get; }

    public IReadOnlyList<AgeNormMetric> Metrics { get; }

    public IReadOnlyList<AgeNormSource> Sources { get; }

    /// <summary>Every norm in file order.</summary>
    public IReadOnlyList<AgeNorm> Norms { get; }

    /// <summary>
    /// The norm of <paramref name="metric"/> whose band holds <paramref name="ageDays"/> (completed days since birth): the
    /// one of <paramref name="population"/>, else the one of <see cref="AgeNormPopulations.All"/>; <c>null</c> when no band
    /// holds the age or the age is negative. Low-confidence norms and norms that need review are returned too (with their
    /// flags): use <see cref="PriorFor"/> for a default.
    /// </summary>
    public AgeNorm? For(string metric, string population, int ageDays)
    {
        ArgumentNullException.ThrowIfNull(metric);
        ArgumentNullException.ThrowIfNull(population);
        return ageDays < 0 ? null : InBand(metric, population, ageDays) ?? InBand(metric, AgeNormPopulations.All, ageDays);
    }

    /// <summary>
    /// <see cref="For"/> when that norm may replace a default (<see cref="AgeNorm.IsUsableAsPrior"/>), else <c>null</c>: a
    /// low-confidence norm or one that needs review is never used as a prior, the caller keeps its own default.
    /// </summary>
    public AgeNorm? PriorFor(string metric, string population, int ageDays) =>
        For(metric, population, ageDays) is { IsUsableAsPrior: true } norm ? norm : null;

    private AgeNorm? InBand(string metric, string population, int ageDays) =>
        _normsByMetricAndPopulation.TryGetValue(Key(metric, population), out var norms)
            ? norms.FirstOrDefault(norm => norm.Band.Contains(ageDays))
            : null;

    private static string Key(string metric, string population) => $"{metric}/{population}";
}

/// <summary>The metric keys the app reads (the file defines more; docs/design/28-age-norms.md section 6).</summary>
public static class AgeNormMetrics
{
    public const string FeedVolumeMlPerFeed = "feed_volume_ml_per_feed";
    public const string FeedsPer24h = "feeds_per_24h";
    public const string FeedGapMinutes = "feed_gap_minutes";
    public const string LongestSleepHours = "longest_sleep_hours";
    public const string NightSleepHours = "night_sleep_hours";
    public const string BedtimeMinutesAfterNoon = "bedtime_minutes_after_noon";
}

/// <summary>The populations a norm is published for.</summary>
public static class AgeNormPopulations
{
    public const string All = "all";
    public const string Breastfed = "breastfed";
    public const string Formula = "formula";
}

/// <summary>How much a merged norm can be trusted (docs/design/28-age-norms.md section 4.5).</summary>
public static class AgeNormConfidence
{
    public const string High = "high";
    public const string Medium = "medium";
    public const string Low = "low";
}

/// <summary>A measured quantity: its key, unit and description; <see cref="MissingReason"/> when no norm could be sourced.</summary>
public sealed record AgeNormMetric(string Key, string Unit, string Description, string? MissingReason);

/// <summary>Where a value comes from, with its licence.</summary>
public sealed record AgeNormSource(
    string Id,
    string Kind,
    string Country,
    string Citation,
    string? Doi,
    string Url,
    DateOnly AccessedOn,
    string Licence,
    string LicenceNote);

/// <summary>An age band in completed days since birth: <c>[FromDays, ToDays)</c>.</summary>
public sealed record AgeNormBand(int FromDays, int ToDays, decimal FromWeeks, decimal ToWeeks, string Label)
{
    public bool Contains(int ageDays) => FromDays <= ageDays && ageDays < ToDays;
}

/// <summary>One source's own value behind a merged norm, with its table or page.</summary>
public sealed record AgeNormEvidence(
    string SourceId,
    string Location,
    string SourceAge,
    decimal? Low,
    decimal? Typical,
    decimal? High,
    string? RangeKind,
    string? TypicalKind,
    decimal? Sd,
    string? Note);

/// <summary>A merged norm for one metric, population and age band (merge rule: docs/design/28-age-norms.md section 4.4).</summary>
public sealed record AgeNorm(
    string Id,
    string Metric,
    string Population,
    string? PopulationNote,
    AgeNormBand Band,
    decimal? Low,
    decimal? Typical,
    decimal? High,
    string Unit,
    string? TypicalSourceId,
    IReadOnlyList<string> SourceIds,
    string Confidence,
    bool NeedsReview,
    string? NeedsReviewReason,
    string? Notes,
    IReadOnlyList<AgeNormEvidence> Evidence)
{
    /// <summary>Whether the norm may replace a default: not low confidence and not waiting for a review.</summary>
    public bool IsUsableAsPrior => !NeedsReview && Confidence != AgeNormConfidence.Low;
}
