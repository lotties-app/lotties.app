using System.Text.RegularExpressions;

namespace Lotties.Domain.AgeNorms;

/// <summary>
/// The rules the age norms file must follow before the API serves it (checked at startup and in tests;
/// docs/design/28-age-norms.md section 11): the supported schema version and the fixed vocabularies (units, populations,
/// range and typical kinds); unique snake_case metric keys with an allowed unit, with norms unless marked missing; unique
/// source slugs with a citation, licence and https url, each used by a norm; norm ids <c>metric.population.fromDays-toDays</c>,
/// a known metric with its unit, a known population, a non-empty band whose weeks match its days,
/// <c>low &lt;= typical &lt;= high</c>, a known confidence, a review reason exactly when <c>needsReview</c>, sources that
/// exist and equal the evidence's; well-formed evidence; the merge rule (section 4.4); no overlapping bands per metric and
/// population.
/// </summary>
public static partial class AgeNormsValidator
{
    public static readonly IReadOnlyList<string> Units = ["hours", "minutes", "count", "ml", "g", "ml_per_kg", "minutes_after_noon", "minutes_after_midnight"];

    public static readonly IReadOnlyList<string> Populations = [AgeNormPopulations.All, AgeNormPopulations.Breastfed, AgeNormPopulations.Formula];

    public static readonly IReadOnlyList<string> RangeKinds = ["recommended", "may_be_appropriate", "mean_pm_1.96sd", "p2_p98", "p2.5_p97.5", "iqr", "min_max", "minimum", "maximum", "reported_range", "statement"];

    public static readonly IReadOnlyList<string> TypicalKinds = ["mean", "pooled_mean", "median", "recommended", "statement"];

    public static readonly IReadOnlyList<string> Confidences = [AgeNormConfidence.High, AgeNormConfidence.Medium, AgeNormConfidence.Low];

    /// <summary>Every rule broken, as readable messages; empty when the norms are valid.</summary>
    public static IReadOnlyList<string> Validate(AgeNormSet norms)
    {
        ArgumentNullException.ThrowIfNull(norms);
        var errors = new List<string>();
        CheckHeader(norms, errors);
        CheckMetrics(norms, errors);
        CheckSources(norms, errors);
        CheckNorms(norms, errors);
        CheckEvidence(norms, errors);
        CheckMergeRule(norms, errors);
        CheckBands(norms, errors);
        return errors;
    }

    /// <summary>Throws <see cref="InvalidOperationException"/> listing every broken rule.</summary>
    public static AgeNormSet EnsureValid(AgeNormSet norms)
    {
        var errors = Validate(norms);
        return errors.Count == 0
            ? norms
            : throw new InvalidOperationException($"The age norms are invalid:{Environment.NewLine}- {string.Join($"{Environment.NewLine}- ", errors)}");
    }

    private static void CheckHeader(AgeNormSet norms, List<string> errors)
    {
        Check(norms.SchemaVersion == AgeNormSet.SupportedSchemaVersion, $"schemaVersion must be {AgeNormSet.SupportedSchemaVersion}.", errors);
        Check(!string.IsNullOrWhiteSpace(norms.Purpose), "purpose is required.", errors);
        Check(norms.Units.SequenceEqual(Units), $"units must be [{string.Join(", ", Units)}].", errors);
        Check(norms.Populations.SequenceEqual(Populations), $"populations must be [{string.Join(", ", Populations)}].", errors);
        Check(norms.RangeKinds.SequenceEqual(RangeKinds), $"rangeKinds must be [{string.Join(", ", RangeKinds)}].", errors);
        Check(norms.TypicalKinds.SequenceEqual(TypicalKinds), $"typicalKinds must be [{string.Join(", ", TypicalKinds)}].", errors);
    }

    private static void CheckMetrics(AgeNormSet norms, List<string> errors)
    {
        CheckUnique(norms.Metrics.Select(metric => metric.Key), "metric", errors);
        foreach (var metric in norms.Metrics)
        {
            var normCount = norms.Norms.Count(norm => norm.Metric == metric.Key);
            var missing = metric.MissingReason is not null;
            Check(SnakeCase().IsMatch(metric.Key), $"metric '{metric.Key}' is not a snake_case key.", errors);
            Check(Units.Contains(metric.Unit), $"metric '{metric.Key}' has unit '{metric.Unit}' outside the allowed set.", errors);
            Check(!string.IsNullOrWhiteSpace(metric.Description), $"metric '{metric.Key}' has no description.", errors);
            Check(!missing || !string.IsNullOrWhiteSpace(metric.MissingReason), $"metric '{metric.Key}' has an empty missingReason.", errors);
            Check(missing ? normCount == 0 : normCount > 0, missing ? $"metric '{metric.Key}' is marked missing but has norms." : $"metric '{metric.Key}' has no norm and no missingReason.", errors);
        }
    }

    private static void CheckSources(AgeNormSet norms, List<string> errors)
    {
        CheckUnique(norms.Sources.Select(source => source.Id), "source", errors);
        var used = norms.Norms.SelectMany(norm => norm.SourceIds).ToHashSet(StringComparer.Ordinal);
        foreach (var source in norms.Sources)
        {
            Check(Slug().IsMatch(source.Id), $"source id '{source.Id}' is not a lower-case slug.", errors);
            Check(new[] { source.Kind, source.Country, source.Citation, source.Licence, source.LicenceNote }.All(text => !string.IsNullOrWhiteSpace(text)), $"source '{source.Id}' needs a kind, country, citation, licence and licenceNote.", errors);
            Check(Uri.TryCreate(source.Url, UriKind.Absolute, out var url) && url.Scheme == Uri.UriSchemeHttps, $"source '{source.Id}' has no https url.", errors);
            Check(used.Contains(source.Id), $"source '{source.Id}' is not used by any norm.", errors);
        }
    }

    private static void CheckNorms(AgeNormSet norms, List<string> errors)
    {
        CheckUnique(norms.Norms.Select(norm => norm.Id), "norm id", errors);
        var metricUnits = norms.Metrics.GroupBy(metric => metric.Key, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First().Unit, StringComparer.Ordinal);
        var sourceIds = norms.Sources.Select(source => source.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var norm in norms.Norms)
        {
            CheckNorm(norm, metricUnits, sourceIds, errors);
        }
    }

    private static void CheckNorm(AgeNorm norm, IReadOnlyDictionary<string, string> metricUnits, IReadOnlySet<string> sourceIds, List<string> errors)
    {
        var band = norm.Band;
        var cited = norm.Evidence.Select(item => item.SourceId).Distinct(StringComparer.Ordinal).ToArray();
        Check(norm.Id == $"{norm.Metric}.{norm.Population}.{band.FromDays}-{band.ToDays}", $"norm '{norm.Id}' is not named metric.population.fromDays-toDays.", errors);
        Check(metricUnits.ContainsKey(norm.Metric), $"norm '{norm.Id}' has unknown metric '{norm.Metric}'.", errors);
        Check(metricUnits.GetValueOrDefault(norm.Metric) == norm.Unit, $"norm '{norm.Id}' has unit '{norm.Unit}', its metric uses '{metricUnits.GetValueOrDefault(norm.Metric)}'.", errors);
        Check(Populations.Contains(norm.Population), $"norm '{norm.Id}' has unknown population '{norm.Population}'.", errors);
        Check(band.FromDays >= 0 && band.ToDays > band.FromDays, $"norm '{norm.Id}' has an empty or negative age band.", errors);
        Check(band.FromWeeks == Math.Round(band.FromDays / 7m, 2) && band.ToWeeks == Math.Round(band.ToDays / 7m, 2), $"norm '{norm.Id}' has weeks that do not match its days.", errors);
        Check(!string.IsNullOrWhiteSpace(band.Label), $"norm '{norm.Id}' has no band label.", errors);
        CheckOrder($"norm '{norm.Id}'", norm.Low, norm.Typical, norm.High, errors);
        Check(Confidences.Contains(norm.Confidence), $"norm '{norm.Id}' has confidence '{norm.Confidence}'.", errors);
        Check(norm.NeedsReview == !string.IsNullOrWhiteSpace(norm.NeedsReviewReason), $"norm '{norm.Id}' needs a review reason exactly when needsReview is true.", errors);
        Check(norm.SourceIds.Count > 0, $"norm '{norm.Id}' cites no source.", errors);
        Check(norm.SourceIds.All(sourceIds.Contains), $"norm '{norm.Id}' cites a source that is not in sources[].", errors);
        Check(norm.SourceIds.SequenceEqual(cited), $"norm '{norm.Id}' sourceIds [{string.Join(",", norm.SourceIds)}] differ from its evidence [{string.Join(",", cited)}].", errors);
    }

    private static void CheckEvidence(AgeNormSet norms, List<string> errors)
    {
        foreach (var (norm, item) in norms.Norms.SelectMany(norm => norm.Evidence.Select(item => (norm, item))))
        {
            var where = $"norm '{norm.Id}' evidence from '{item.SourceId}'";
            var hasRange = item.Low is not null || item.High is not null;
            Check(!string.IsNullOrWhiteSpace(item.Location) && !string.IsNullOrWhiteSpace(item.SourceAge), $"{where} has no location or source age.", errors);
            CheckOrder(where, item.Low, item.Typical, item.High, errors);
            Check(hasRange ? item.RangeKind is not null && RangeKinds.Contains(item.RangeKind) : item.RangeKind is null, $"{where} needs a known rangeKind exactly when it gives a low or a high.", errors);
            Check(item.Typical is not null ? item.TypicalKind is not null && TypicalKinds.Contains(item.TypicalKind) : item.TypicalKind is null, $"{where} needs a known typicalKind exactly when it gives a typical.", errors);
            Check(item.Sd is null or > 0m, $"{where} has a non-positive sd.", errors);
        }
    }

    private static void CheckMergeRule(AgeNormSet norms, List<string> errors)
    {
        foreach (var norm in norms.Norms)
        {
            var typicals = norm.Evidence.Select(item => item.Typical).OfType<decimal>().ToArray();
            var lows = norm.Evidence.Select(item => item.Low).OfType<decimal>().ToArray();
            var highs = norm.Evidence.Select(item => item.High).OfType<decimal>().ToArray();
            decimal? expectedLow = lows.Length > 0 ? lows.Concat(typicals).Min() : null;
            decimal? expectedHigh = highs.Length > 0 ? highs.Concat(typicals).Max() : null;
            Check(norm.Low == expectedLow, $"norm '{norm.Id}' low {norm.Low} is not the smallest evidence value {expectedLow}.", errors);
            Check(norm.High == expectedHigh, $"norm '{norm.Id}' high {norm.High} is not the largest evidence value {expectedHigh}.", errors);
            Check(TypicalFollowsTheRule(norm, typicals), $"norm '{norm.Id}' typical {norm.Typical} does not come from '{norm.TypicalSourceId}' (or is set without a published central value).", errors);
        }
    }

    private static bool TypicalFollowsTheRule(AgeNorm norm, IReadOnlyList<decimal> typicals) =>
        norm.TypicalSourceId is null
            ? norm.Typical is null && typicals.Count == 0
            : norm.Evidence.Any(item => item.SourceId == norm.TypicalSourceId && item.Typical == norm.Typical);

    private static void CheckBands(AgeNormSet norms, List<string> errors)
    {
        foreach (var group in norms.Norms.GroupBy(norm => $"{norm.Metric}/{norm.Population}", StringComparer.Ordinal))
        {
            var bands = group.OrderBy(norm => norm.Band.FromDays).ToArray();
            var overlaps = bands.Zip(bands.Skip(1)).Where(pair => pair.First.Band.ToDays > pair.Second.Band.FromDays);
            errors.AddRange(overlaps.Select(pair => $"'{pair.First.Id}' overlaps '{pair.Second.Id}'."));
        }
    }

    private static void CheckOrder(string where, decimal? low, decimal? typical, decimal? high, List<string> errors)
    {
        Check(low is not null || typical is not null || high is not null, $"{where} gives no value.", errors);
        Check(low is null || typical is null || low <= typical, $"{where} low {low} is above typical {typical}.", errors);
        Check(typical is null || high is null || typical <= high, $"{where} typical {typical} is above high {high}.", errors);
        Check(low is null || high is null || low <= high, $"{where} low {low} is above high {high}.", errors);
    }

    private static void CheckUnique(IEnumerable<string> values, string what, List<string> errors) =>
        errors.AddRange(values.GroupBy(value => value, StringComparer.Ordinal).Where(group => group.Count() > 1).Select(group => $"{what} '{group.Key}' is listed twice."));

    private static void Check(bool condition, string error, List<string> errors)
    {
        if (!condition)
        {
            errors.Add(error);
        }
    }

    [GeneratedRegex("^[a-z][a-z0-9]*(_[a-z0-9]+)*$")]
    private static partial Regex SnakeCase();

    [GeneratedRegex("^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex Slug();
}
