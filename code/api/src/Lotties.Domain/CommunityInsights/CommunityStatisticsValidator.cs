using System.Text.RegularExpressions;

namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// The rules the community statistics catalog must follow (checked at startup and in tests; docs/design/34-community-insights.md
/// sections 4, 5 and 13): schema 1, a positive version, <c>generatedFor</c> saying nothing is collected, a known release
/// cadence; contiguous band grids from week 0 whose coarse edges are fine edges and the four cry age bands; exactly the
/// use cases of section 4, each once; per statistic a description, inputs only from <see cref="AllowedInputs"/> and never
/// one of <see cref="ForbiddenCategories"/>, the band's grid and dimension fed by its inputs, known outputs, k at least
/// <see cref="MinimumK"/>, a hysteresis at most k, a tail size of at least <see cref="MinimumKTails"/> exactly when p3/p97
/// are published, epsilon in (0, <see cref="MaximumEpsilon"/>], a per-baby cap, clipping ranges on its own inputs,
/// status <c>planned</c>, values marked proposed, and <c>notInV1</c> (with a reason) exactly for pooled growth (O6).
/// </summary>
public static partial class CommunityStatisticsValidator
{
    /// <summary>Proposal O1: 20 distinct babies from 20 distinct families per cell.</summary>
    public const int MinimumK = 20;

    /// <summary>Proposal O1: percentiles outside p10-p90 only at 50 babies or more.</summary>
    public const int MinimumKTails = 50;

    /// <summary>The largest epsilon per statistic per release (O2 proposes 0.2 weekly or 0.5 monthly).</summary>
    public const decimal MaximumEpsilon = 1m;

    /// <summary>The largest number of values one baby may add per statistic and band.</summary>
    public const int MaximumCapPerBaby = 31;

    public const string PlannedStatus = "planned";

    public const string AgeWeeksGrid = "age_weeks";

    public const string CryAgeBandGrid = "cry_age_band";

    /// <summary>The last week (exclusive) the age grids cover: two years.</summary>
    public const int AgeWeeksEnd = 104;

    /// <summary>The use cases of section 4, one entry each, nothing else.</summary>
    public static readonly IReadOnlyList<string> KnownKeys =
    [
        "bottle_ml_per_feed", "growth_vs_age", "tummy_minutes_per_day", "naps_per_day", "day_sleep_minutes",
        "night_sleep_minutes", "feeds_per_day", "diapers_per_day", "routine_shift_scale", "cry_outcome_by_cause",
    ];

    /// <summary>The statistics that stay out of v1 (O6: no pooled growth, WHO curves first).</summary>
    public static readonly IReadOnlyList<string> NotInV1Keys = ["growth_vs_age"];

    public static readonly IReadOnlyList<string> Releases = ["weekly", "monthly"];

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

    public static readonly IReadOnlyList<string> Outputs =
    [
        "p3", "p10", "p15", "p25", "p50", "p75", "p85", "p90", "p97",
        "bottles_per_day_p50", "share_of_days_with_any",
        "shift_ratio_p90", "shift_ratio_p97",
        "share_helped_by_cause", "share_suggested_equals_helped",
    ];

    /// <summary>Outputs outside p10-p90, published only at <see cref="MinimumKTails"/> babies.</summary>
    public static readonly IReadOnlyList<string> TailOutputs = ["p3", "p97", "shift_ratio_p97"];

    /// <summary>Each band dimension and the inputs it is read from.</summary>
    public static readonly IReadOnlyDictionary<string, IReadOnlyList<string>> Dimensions = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal)
    {
        ["bottle_feeding_type"] = ["bottle_feeding_type"],
        ["part_of_day"] = ["part_of_day"],
        ["routine_metric"] = ["naps_per_day", "day_sleep_minutes", "night_sleep_minutes", "feeds_per_day", "diapers_per_day"],
    };

    /// <summary>Each grid and the input it is read from.</summary>
    public static readonly IReadOnlyDictionary<string, string> Grids = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [AgeWeeksGrid] = "age_weeks",
        [CryAgeBandGrid] = "cry_age_band",
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
        Check(grids.CryAgeBands.SequenceEqual(CryAgeBands), $"cryAgeBands must be [{string.Join(", ", CryAgeBands)}].", errors);
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
    }

    private static void CheckBand(CommunityStatistic statistic, string where, List<string> errors)
    {
        var band = statistic.Band;
        Check(Grids.TryGetValue(band.Grid, out var gridInput) && statistic.Inputs.Contains(gridInput), $"{where} band grid '{band.Grid}' is unknown or its input is not read.", errors);
        Check(band.Dimension is null || (Dimensions.TryGetValue(band.Dimension, out var sources) && sources.All(statistic.Inputs.Contains)), $"{where} band dimension '{band.Dimension}' is unknown or its inputs are not read.", errors);
    }

    private static void CheckOutputs(CommunityStatistic statistic, string where, List<string> errors)
    {
        Check(statistic.Outputs.Count > 0, $"{where} has no outputs.", errors);
        Check(statistic.Outputs.Distinct(StringComparer.Ordinal).Count() == statistic.Outputs.Count, $"{where} lists an output twice.", errors);
        errors.AddRange(statistic.Outputs.Where(output => !Outputs.Contains(output)).Select(output => $"{where} output '{output}' is unknown."));
    }

    private static void CheckPrivacy(CommunityStatistic statistic, string where, List<string> errors)
    {
        var hasTails = statistic.Outputs.Any(TailOutputs.Contains);
        Check(statistic.K >= MinimumK, $"{where} k {statistic.K} is below {MinimumK}.", errors);
        Check(statistic.KHysteresis >= 1 && statistic.KHysteresis <= statistic.K, $"{where} kHysteresis {statistic.KHysteresis} must be between 1 and k.", errors);
        Check(hasTails ? statistic.KTails >= MinimumKTails : statistic.KTails is null, $"{where} needs kTails of at least {MinimumKTails} exactly when it publishes p3/p97.", errors);
        Check(statistic.Epsilon > 0m && statistic.Epsilon <= MaximumEpsilon, $"{where} epsilon {statistic.Epsilon} is out of range (0, {MaximumEpsilon}].", errors);
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
        var notInV1 = NotInV1Keys.Contains(statistic.Key);
        Check(statistic.Status == PlannedStatus, $"{where} status '{statistic.Status}' must be '{PlannedStatus}'.", errors);
        Check(statistic.Proposed, $"{where} must be marked proposed until the owner decides O1 and O2.", errors);
        Check(statistic.NotInV1 == notInV1, notInV1 ? $"{where} must be marked notInV1 (O6)." : $"{where} must not be marked notInV1.", errors);
        Check(statistic.NotInV1 == !string.IsNullOrWhiteSpace(statistic.NotInV1Reason), $"{where} needs a notInV1Reason exactly when notInV1 is true.", errors);
    }

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
