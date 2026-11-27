using System.Text.RegularExpressions;

namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The rules the community statistics catalog must follow (checked at startup, by the aggregation core and in tests;
/// docs/design/34-community-insights.md sections 4, 5, 5.1 and 13): schema 2, a positive version, <c>generatedFor</c> saying nothing
/// is collected, the quarterly release cadence; contiguous band grids from week 0 whose coarse edges are fine edges, and the four cry age
/// bands on contiguous week edges; exactly the use cases of section 4, each once; per statistic a description, inputs only from
/// <see cref="AllowedInputs"/> and never one of <see cref="ForbiddenCategories"/>, the band's grid and dimension fed by its inputs,
/// known outputs, k at least <see cref="MinimumK"/>, a tail size of at least <see cref="MinimumKTails"/>
/// exactly when p3/p97 are listed, a per-baby cap, clipping ranges on its own inputs, status <c>planned</c>, values marked proposed;
/// and the noise tiers of sections 5.1 and 5.1.1: every output in exactly the tier the owner decided (<see cref="DecidedTiers"/>) and
/// only when the core computes it, no percentile in v1 but the quartiles of tier C, pooled growth <c>notInV1</c> (O6), one tier per
/// statistic, epsilon null exactly when nothing is in v1 and otherwise in the tier's range (tier C: exactly
/// <see cref="EpsilonPerCellC"/> times the cell bound), a tier C statistic on the 4-week grid with no dimension, the cell bound of
/// <see cref="MaxCellsPerBabyC"/>, the previous-quarter window, a histogram and one clip range, and no bound, window or histogram on
/// any other statistic; <c>notInV1</c> exactly when no output is in v1, a <c>notInV1Reason</c> exactly when an output is not, and for
/// a statistic in v1 inputs that are exactly what the core reads.
/// </summary>
public static partial class CommunityStatisticsValidator
{
    /// <summary>Proposal O1: 20 distinct babies from 20 distinct families per cell.</summary>
    public const int MinimumK = 20;

    /// <summary>Proposal O1: percentiles outside p10-p90 only at 50 babies or more.</summary>
    public const int MinimumKTails = 50;

    /// <summary>The largest epsilon per statistic per release of tier A, strict (decided: 0.2).</summary>
    public const decimal MaximumStrictEpsilon = 1m;

    /// <summary>The largest epsilon per statistic per release of tier B, relaxed (decided: about 5).</summary>
    public const decimal MaximumRelaxedEpsilon = 5m;

    /// <summary>Tier C (option A as bounded on 2026-11-27): epsilon per cell and release of the percentile histograms.</summary>
    public const decimal EpsilonPerCellC = 2m;

    /// <summary>Tier C: the most cells of one percentile statistic one baby is in per release.</summary>
    public const int MaxCellsPerBabyC = 4;

    /// <summary>The largest number of days one baby may add per statistic and band.</summary>
    public const int MaximumCapPerBaby = 31;

    public const string PlannedStatus = "planned";

    public const string AgeWeeksGrid = "age_weeks";

    public const string CryAgeBandGrid = "cry_age_band";

    /// <summary>The 4-week grid of the percentile statistics (owner default of 2026-11-27), with no coarse fallback.</summary>
    public const string AgeWeeks4Grid = "age_weeks_4";

    /// <summary>The last week (exclusive) the age grids cover: two years.</summary>
    public const int AgeWeeksEnd = 104;

    public const string GrowthKey = "growth_vs_age";

    /// <summary>The use cases of section 4, one entry each, nothing else.</summary>
    public static readonly IReadOnlyList<string> KnownKeys =
    [
        "bottle_ml_per_feed", GrowthKey, "tummy_minutes_per_day", "naps_per_day", "day_sleep_minutes",
        "night_sleep_minutes", "feeds_per_day", "diapers_per_day", "routine_shift_scale", "cry_outcome_by_cause",
    ];

    /// <summary>The percentile statistics of tier C (owner decisions of 2026-11-27): formula bottles and the three sleep routines.</summary>
    public static readonly IReadOnlyList<string> PercentileStatistics = ["bottle_ml_per_feed", "night_sleep_minutes", "naps_per_day", "day_sleep_minutes"];

    /// <summary>
    /// The tier the owner decided for each output (sections 5.1 and 5.1.1): the crying shares in tier A (one output, 2026-11-27), the
    /// tummy-time share of days in tier B, and p25, p50 and p75 of <see cref="PercentileStatistics"/> in tier C. Every other output is
    /// <c>notInV1</c>.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, CommunityOutputTier> DecidedTiers = new Dictionary<string, CommunityOutputTier>(
        new[]
        {
            KeyValuePair.Create($"cry_outcome_by_cause.{CommunityOutputs.ShareHelpedByCause}", CommunityOutputTier.A),
            KeyValuePair.Create($"tummy_minutes_per_day.{CommunityOutputs.ShareOfDaysWithAny}", CommunityOutputTier.B),
        }.Concat(PercentileStatistics.SelectMany(key => CommunityOutputs.Quantiles.Select(output => KeyValuePair.Create($"{key}.{output}", CommunityOutputTier.C)))),
        StringComparer.Ordinal);

    /// <summary>The release cadence (owner decision of 2026-11-27): one release per calendar quarter, never weekly.</summary>
    public static readonly IReadOnlyList<string> Releases = ["quarterly"];

    /// <summary>The web's <c>cryAgeBand</c> values (docs/design/27), in order.</summary>
    public static readonly IReadOnlyList<string> CryAgeBands = ["newborn", "weeks6to3m", "months3to6", "months6plus"];

    /// <summary>
    /// Every value the job may derive per baby (section 4 "Exact inputs"): age in completed weeks or the cry age band
    /// (never the birth date), the local day and part of day (never a timestamp), and the per-day or per-entry values.
    /// </summary>
    public static readonly IReadOnlyList<string> AllowedInputs =
    [
        "age_weeks", "cry_age_band", "local_day", "part_of_day",
        "bottle_drunk_ml", "bottle_feeding_type", "bottles_per_day",
        "weight_kg", "length_cm", "head_cm",
        "tummy_minutes_per_day",
        "naps_per_day", "day_sleep_minutes", "night_sleep_minutes", "feeds_per_day", "diapers_per_day",
        "what_helped_cause", "suggested_cause", "cry_duration_bucket",
    ];

    /// <summary>
    /// Section 4 "Never read by the job", as categories and the snake_case words that name them; an input containing
    /// one of these words is refused even if someone adds it to <see cref="AllowedInputs"/>.
    /// </summary>
    public static readonly IReadOnlyDictionary<string, IReadOnlyList<string>> ForbiddenCategories = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal)
    {
        ["names"] = ["name", "names", "nickname"],
        ["birth date"] = ["birth", "birthdate", "birthday", "dob"],
        ["event timestamps"] = ["timestamp", "time", "datetime", "clock", "started", "ended", "at"],
        ["notes"] = ["note", "notes", "comment"],
        ["custom text"] = ["custom", "text", "free", "label"],
        ["medications"] = ["medication", "medications", "medicine", "dose", "drug"],
        ["prescriptions"] = ["prescription", "prescriptions"],
        ["vaccines"] = ["vaccine", "vaccines", "vaccination"],
        ["symptoms"] = ["symptom", "symptoms"],
        ["temperatures"] = ["temperature", "temp", "fever"],
        ["appointments"] = ["appointment", "appointments", "consultation"],
        ["care providers"] = ["provider", "providers", "clinic", "pediatrician"],
        ["members"] = ["member", "members", "invite", "caregiver", "parent", "owner"],
        ["doctor data"] = ["doctor", "physician", "professional"],
        ["push"] = ["push", "notification", "subscription"],
        ["assistant data"] = ["assistant", "alexa", "mcp", "utterance", "voice"],
        ["account"] = ["account", "user", "email", "issuer", "sub", "password", "consent"],
    };

    /// <summary>Each band dimension and the inputs it is read from.</summary>
    public static readonly IReadOnlyDictionary<string, IReadOnlyList<string>> Dimensions = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal)
    {
        [CommunityDimensions.BottleFeedingType] = ["bottle_feeding_type"],
        [CommunityDimensions.PartOfDay] = ["part_of_day"],
        [CommunityDimensions.RoutineMetric] = ["naps_per_day", "day_sleep_minutes", "night_sleep_minutes", "feeds_per_day", "diapers_per_day"],
    };

    /// <summary>Each grid and the input it is read from.</summary>
    public static readonly IReadOnlyDictionary<string, string> Grids = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [AgeWeeksGrid] = "age_weeks",
        [CryAgeBandGrid] = "age_weeks",
        [AgeWeeks4Grid] = "age_weeks",
    };

    /// <summary>Every rule broken, as readable messages; empty when the catalog is valid.</summary>
    public static IReadOnlyList<string> Validate(CommunityStatisticsCatalog catalog)
    {
        ArgumentNullException.ThrowIfNull(catalog);
        var errors = new List<string>();
        CheckHeader(catalog, errors);
        CheckGrids(catalog.BandGrids, errors);
        CheckKeys(catalog.Statistics, errors);
        foreach (var statistic in catalog.Statistics)
        {
            CheckStatistic(statistic, errors);
        }

        return errors;
    }

    /// <summary>Throws <see cref="InvalidOperationException"/> listing every broken rule.</summary>
    public static CommunityStatisticsCatalog EnsureValid(CommunityStatisticsCatalog catalog)
    {
        var errors = Validate(catalog);
        return errors.Count == 0
            ? catalog
            : throw new InvalidOperationException($"The community statistics catalog is invalid:{Environment.NewLine}- {string.Join($"{Environment.NewLine}- ", errors)}");
    }

    /// <summary>The forbidden categories an input names (by its snake_case words); empty when it names none.</summary>
    public static IReadOnlyList<string> ForbiddenCategoriesOf(string input)
    {
        ArgumentNullException.ThrowIfNull(input);
        var words = input.ToLowerInvariant().Split('_', StringSplitOptions.RemoveEmptyEntries);
        return ForbiddenCategories.Where(category => category.Value.Intersect(words, StringComparer.Ordinal).Any()).Select(category => category.Key).ToArray();
    }

    private static void CheckHeader(CommunityStatisticsCatalog catalog, List<string> errors)
    {
        Check(catalog.Schema == CommunityStatisticsCatalog.SupportedSchema, $"schema must be {CommunityStatisticsCatalog.SupportedSchema}.", errors);
        Check(catalog.Version >= 1, "version must be 1 or more.", errors);
        Check(catalog.GeneratedFor == CommunityStatisticsCatalog.CatalogOnly, $"generatedFor must be '{CommunityStatisticsCatalog.CatalogOnly}'.", errors);
        Check(Releases.Contains(catalog.Release), $"release '{catalog.Release}' must be one of [{string.Join(", ", Releases)}].", errors);
    }

    private static void CheckGrids(CommunityBandGrids grids, List<string> errors)
    {
        var fine = EdgesOf(grids.AgeWeeksFine, "ageWeeksFine", errors);
        var coarse = EdgesOf(grids.AgeWeeksCoarse, "ageWeeksCoarse", errors);
        Check(coarse.All(fine.Contains), "every ageWeeksCoarse edge must be an ageWeeksFine edge.", errors);
        EdgesOf(grids.AgeWeeks4, "ageWeeks4", errors);
        Check(grids.AgeWeeks4.All(segment => segment.StepWeeks == 4), "ageWeeks4 must be 4-week bands.", errors);
        CheckCryBands(grids.CryAgeBands, errors);
    }

    private static void CheckCryBands(IReadOnlyList<CommunityNamedBand> bands, List<string> errors)
    {
        Check(bands.Select(band => band.Name).SequenceEqual(CryAgeBands), $"cryAgeBands must be [{string.Join(", ", CryAgeBands)}].", errors);
        Check(bands.Count > 0 && bands[0].FromWeeks == 0 && bands[^1].ToWeeks == AgeWeeksEnd, $"cryAgeBands must run from week 0 to week {AgeWeeksEnd}.", errors);
        Check(bands.All(band => band.ToWeeks > band.FromWeeks) && bands.Zip(bands.Skip(1)).All(pair => pair.First.ToWeeks == pair.Second.FromWeeks), "cryAgeBands must be non-empty and contiguous.", errors);
    }

    private static IReadOnlySet<int> EdgesOf(IReadOnlyList<CommunityBandSegment> segments, string name, List<string> errors)
    {
        Check(segments.Count > 0 && segments[0].FromWeeks == 0, $"{name} must start at week 0.", errors);
        Check(segments.Count > 0 && segments[^1].ToWeeks == AgeWeeksEnd, $"{name} must end at week {AgeWeeksEnd}.", errors);
        Check(segments.Zip(segments.Skip(1)).All(pair => pair.First.ToWeeks == pair.Second.FromWeeks), $"{name} segments must be contiguous.", errors);
        Check(segments.All(IsWholeSteps), $"{name} segments must have a positive step that divides them.", errors);
        return segments.Where(IsWholeSteps).SelectMany(StepEdges).ToHashSet();
    }

    private static bool IsWholeSteps(CommunityBandSegment segment) =>
        segment.StepWeeks > 0 && segment.ToWeeks > segment.FromWeeks && (segment.ToWeeks - segment.FromWeeks) % segment.StepWeeks == 0;

    private static IEnumerable<int> StepEdges(CommunityBandSegment segment) =>
        Enumerable.Range(0, ((segment.ToWeeks - segment.FromWeeks) / segment.StepWeeks) + 1).Select(step => segment.FromWeeks + (step * segment.StepWeeks));

    private static void CheckKeys(IReadOnlyList<CommunityStatistic> statistics, List<string> errors)
    {
        var keys = statistics.Select(statistic => statistic.Key).ToArray();
        errors.AddRange(keys.GroupBy(key => key, StringComparer.Ordinal).Where(group => group.Count() > 1).Select(group => $"statistic '{group.Key}' is listed twice."));
        errors.AddRange(keys.Except(KnownKeys, StringComparer.Ordinal).Select(key => $"statistic '{key}' is not a use case of section 4."));
        errors.AddRange(KnownKeys.Except(keys, StringComparer.Ordinal).Select(key => $"statistic '{key}' is missing."));
    }

    private static void CheckStatistic(CommunityStatistic statistic, List<string> errors)
    {
        var where = $"statistic '{statistic.Key}'";
        Check(SnakeCase().IsMatch(statistic.Key), $"{where} is not a snake_case key.", errors);
        Check(!string.IsNullOrWhiteSpace(statistic.Description), $"{where} has no description.", errors);
        CheckInputs(statistic, where, errors);
        CheckBand(statistic, where, errors);
        CheckOutputs(statistic, where, errors);
        CheckTiers(statistic, where, errors);
        CheckEpsilon(statistic, where, errors);
        CheckPercentileShape(statistic, where, errors);
        CheckPrivacy(statistic, where, errors);
        CheckClip(statistic, where, errors);
        CheckStatus(statistic, where, errors);
    }

    private static void CheckInputs(CommunityStatistic statistic, string where, List<string> errors)
    {
        Check(statistic.Inputs.Count > 0, $"{where} has no inputs.", errors);
        Check(statistic.Inputs.Distinct(StringComparer.Ordinal).Count() == statistic.Inputs.Count, $"{where} lists an input twice.", errors);
        errors.AddRange(statistic.Inputs.Where(input => !AllowedInputs.Contains(input)).Select(input => $"{where} input '{input}' is not in the allowed inputs."));
        errors.AddRange(statistic.Inputs.SelectMany(input => ForbiddenCategoriesOf(input).Select(category => $"{where} input '{input}' reads a forbidden category ({category}).")));
        CheckInputsRead(statistic, where, errors);
    }

    /// <summary>The published list must not over-declare: a statistic in v1 lists exactly the inputs the core reads for it.</summary>
    private static void CheckInputsRead(CommunityStatistic statistic, string where, List<string> errors)
    {
        var read = statistic.IsInV1 ? CommunityStatisticsAggregator.InputsReadFor(statistic) : null;
        Check(read is null || read.Order(StringComparer.Ordinal).SequenceEqual(statistic.Inputs.Order(StringComparer.Ordinal)), $"{where} inputs must be exactly what the aggregation core reads: [{string.Join(", ", read ?? [])}].", errors);
    }

    private static void CheckBand(CommunityStatistic statistic, string where, List<string> errors)
    {
        var band = statistic.Band;
        Check(Grids.TryGetValue(band.Grid, out var gridInput) && statistic.Inputs.Contains(gridInput), $"{where} band grid '{band.Grid}' is unknown or its input is not read.", errors);
        Check(band.Dimension is null || (Dimensions.TryGetValue(band.Dimension, out var sources) && sources.All(statistic.Inputs.Contains)), $"{where} band dimension '{band.Dimension}' is unknown or its inputs are not read.", errors);
    }

    private static void CheckOutputs(CommunityStatistic statistic, string where, List<string> errors)
    {
        var names = statistic.Outputs.Select(output => output.Name).ToArray();
        Check(names.Length > 0, $"{where} has no outputs.", errors);
        Check(names.Distinct(StringComparer.Ordinal).Count() == names.Length, $"{where} lists an output twice.", errors);
        errors.AddRange(names.Where(name => !CommunityOutputs.All.Contains(name)).Select(name => $"{where} output '{name}' is unknown."));
    }

    private static void CheckTiers(CommunityStatistic statistic, string where, List<string> errors)
    {
        errors.AddRange(statistic.V1Outputs.Where(output => CommunityOutputs.Percentiles.Contains(output.Name) && !IsTierCQuartile(output)).Select(output => $"{where} output '{output.Name}' is a percentile and must be notInV1 (O2, section 5.1) unless it is a tier C quartile."));
        Check(statistic.Key != GrowthKey || !statistic.IsInV1, $"{where} must be marked notInV1 (O6).", errors);
        errors.AddRange(statistic.Outputs.Where(output => output.Tier != DecidedTierOf(statistic, output)).Select(output => $"{where} output '{output.Name}' must be tier {DecidedTierOf(statistic, output)} (section 5.1)."));
        errors.AddRange(statistic.V1Outputs.Where(output => !CommunityOutputs.IsBuilt(output.Name)).Select(output => $"{where} output '{output.Name}' has no mechanism built and must be notInV1."));
        Check(!statistic.IsInV1 || CommunityStatisticsAggregator.CanRead(statistic), $"{where} is in v1 but the aggregation core does not read it.", errors);
        Check(statistic.V1Outputs.Select(output => output.Tier).Distinct().Count() <= 1, $"{where} mixes noise tiers in v1.", errors);
    }

    private static void CheckEpsilon(CommunityStatistic statistic, string where, List<string> errors)
    {
        var tier = statistic.V1Outputs.Select(output => (CommunityOutputTier?)output.Tier).FirstOrDefault();
        Check((statistic.Epsilon is null) == (tier is null), $"{where} epsilon must be null exactly when no output is in v1.", errors);
        Check(tier != CommunityOutputTier.A || statistic.Epsilon is > 0m and <= MaximumStrictEpsilon, $"{where} epsilon {statistic.Epsilon} is out of the tier A range (0, {MaximumStrictEpsilon}].", errors);
        Check(tier != CommunityOutputTier.B || statistic.Epsilon is > MaximumStrictEpsilon and <= MaximumRelaxedEpsilon, $"{where} epsilon {statistic.Epsilon} is out of the tier B range ({MaximumStrictEpsilon}, {MaximumRelaxedEpsilon}].", errors);
        Check(tier != CommunityOutputTier.C || statistic.Epsilon == EpsilonPerCellC * (statistic.MaxCellsPerBaby ?? 0), $"{where} epsilon {statistic.Epsilon} must be {EpsilonPerCellC} per cell times the cell bound (tier C).", errors);
    }

    /// <summary>
    /// A tier C statistic is the bounded option A (section 5.1.1): the 4-week grid with no dimension, at most 4 cells per baby, the
    /// previous-quarter window, a histogram with positive bins and step, and one clip range; no other statistic has any of these.
    /// </summary>
    private static void CheckPercentileShape(CommunityStatistic statistic, string where, List<string> errors)
    {
        var tierC = statistic.V1Outputs.Any(output => output.Tier == CommunityOutputTier.C);
        var histogram = statistic.Histogram;
        Check(!tierC || (statistic.Band.Grid == AgeWeeks4Grid && statistic.Band.Dimension is null), $"{where} is tier C and must use the {AgeWeeks4Grid} grid with no dimension.", errors);
        Check(!tierC || statistic.MaxCellsPerBaby == MaxCellsPerBabyC, $"{where} is tier C and must keep each baby in at most {MaxCellsPerBabyC} cells.", errors);
        Check(!tierC || statistic.Window == CommunityStatisticsAggregator.PreviousQuarterWindow, $"{where} is tier C and must read only the {CommunityStatisticsAggregator.PreviousQuarterWindow}.", errors);
        Check(!tierC || (histogram is not null && histogram.BinWidth > 0m && histogram.Step > 0m && statistic.Clip.Count == 1), $"{where} is tier C and needs a histogram with a positive bin width and step, and one clip range.", errors);
        Check(tierC || (statistic.MaxCellsPerBaby is null && statistic.Window is null && histogram is null), $"{where} has a cell bound, window or histogram but no tier C output.", errors);
    }

    private static void CheckPrivacy(CommunityStatistic statistic, string where, List<string> errors)
    {
        var hasTails = statistic.Outputs.Any(output => CommunityOutputs.Tails.Contains(output.Name));
        Check(statistic.K >= MinimumK, $"{where} k {statistic.K} is below {MinimumK}.", errors);
        Check(hasTails ? statistic.KTails >= MinimumKTails : statistic.KTails is null, $"{where} needs kTails of at least {MinimumKTails} exactly when it publishes p3/p97.", errors);
        Check(statistic.CapPerBaby >= 1 && statistic.CapPerBaby <= MaximumCapPerBaby, $"{where} capPerBaby {statistic.CapPerBaby} must be between 1 and {MaximumCapPerBaby}.", errors);
    }

    private static void CheckClip(CommunityStatistic statistic, string where, List<string> errors)
    {
        Check(statistic.Clip.Select(clip => clip.Input).Distinct(StringComparer.Ordinal).Count() == statistic.Clip.Count, $"{where} clips an input twice.", errors);
        errors.AddRange(statistic.Clip.Where(clip => !statistic.Inputs.Contains(clip.Input)).Select(clip => $"{where} clips '{clip.Input}', which it does not read."));
        errors.AddRange(statistic.Clip.Where(clip => clip.Min >= clip.Max || string.IsNullOrWhiteSpace(clip.Unit)).Select(clip => $"{where} clip of '{clip.Input}' needs min below max and a unit."));
    }

    private static void CheckStatus(CommunityStatistic statistic, string where, List<string> errors)
    {
        var anyDeferred = statistic.Outputs.Any(output => !output.IsInV1);
        Check(statistic.Status == PlannedStatus, $"{where} status '{statistic.Status}' must be '{PlannedStatus}'.", errors);
        Check(statistic.Proposed, $"{where} must be marked proposed until the owner decides O1.", errors);
        Check(statistic.NotInV1 == !statistic.IsInV1, statistic.IsInV1 ? $"{where} must not be marked notInV1 (an output is in v1)." : $"{where} must be marked notInV1 (no output is in v1).", errors);
        Check(anyDeferred == !string.IsNullOrWhiteSpace(statistic.NotInV1Reason), $"{where} needs a notInV1Reason exactly when an output is notInV1.", errors);
    }

    private static bool IsTierCQuartile(CommunityStatisticOutput output) =>
        output.Tier == CommunityOutputTier.C && CommunityOutputs.Quantiles.Contains(output.Name);

    private static CommunityOutputTier DecidedTierOf(CommunityStatistic statistic, CommunityStatisticOutput output) =>
        DecidedTiers.GetValueOrDefault($"{statistic.Key}.{output.Name}", CommunityOutputTier.NotInV1);

    private static void Check(bool condition, string error, List<string> errors)
    {
        if (!condition)
        {
            errors.Add(error);
        }
    }

    [GeneratedRegex("^[a-z][a-z0-9]*(_[a-z0-9]+)*$")]
    private static partial Regex SnakeCase();
}
