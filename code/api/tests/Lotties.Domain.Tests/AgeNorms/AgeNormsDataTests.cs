using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Lotties.Domain.Tests.AgeNorms;

/// <summary>
/// The published age norms (code/api/data/age-norms.json, linked into the test output; docs/design/28-age-norms.md
/// section 5): well formed, every merged number traceable to a cited source, units from the allowed set, and bands that
/// never overlap per metric and population. The app does not read the file yet; the wiring task embeds it.
/// </summary>
public sealed partial class AgeNormsDataTests
{
    private static readonly string[] Units = ["hours", "minutes", "count", "ml", "g", "ml_per_kg", "minutes_after_noon", "minutes_after_midnight"];

    private static readonly string[] Populations = ["all", "breastfed", "formula"];

    private static readonly string[] RangeKinds = ["recommended", "may_be_appropriate", "mean_pm_1.96sd", "p2_p98", "p2.5_p97.5", "iqr", "min_max", "minimum", "maximum", "reported_range", "statement"];

    private static readonly string[] TypicalKinds = ["mean", "pooled_mean", "median", "recommended", "statement"];

    private static readonly string[] Confidences = ["high", "medium", "low"];

    private static readonly Lazy<string> Text = new(() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "AgeNorms", "age-norms.json")));

    private static readonly Lazy<JsonDocument> Document = new(() => JsonDocument.Parse(Text.Value));

    private static JsonElement Root => Document.Value.RootElement;

    private static IEnumerable<JsonElement> Norms => Root.GetProperty("norms").EnumerateArray();

    private static IEnumerable<JsonElement> Sources => Root.GetProperty("sources").EnumerateArray();

    private static IEnumerable<JsonElement> Metrics => Root.GetProperty("metrics").EnumerateArray();

    [Fact]
    public void File_IsCanonicalJsonWithTheSchemaHeader()
    {
        // Git for Windows may check the file out with CRLF (no .gitattributes), so line endings are not asserted.
        Assert.EndsWith("}\n", Text.Value.Replace("\r\n", "\n", StringComparison.Ordinal), StringComparison.Ordinal);
        Assert.Equal(1, Root.GetProperty("schemaVersion").GetInt32());
        Assert.True(DateOnly.TryParseExact(Root.GetProperty("generatedAt").GetString(), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _));
        Assert.Equal(Units, Strings(Root.GetProperty("units")));
        Assert.Equal(Populations, Strings(Root.GetProperty("populations")));
        Assert.Equal(RangeKinds, Strings(Root.GetProperty("rangeKinds")));
        Assert.Equal(TypicalKinds, Strings(Root.GetProperty("typicalKinds")));
        Assert.False(string.IsNullOrWhiteSpace(Root.GetProperty("purpose").GetString()));
    }

    [Fact]
    public void File_KeepsTheResearchCounts()
    {
        // Pinned on purpose: change these with the data and with docs/design/28-age-norms.md.
        Assert.Equal(18, Sources.Count());
        Assert.Equal(22, Metrics.Count());
        Assert.Equal(91, Norms.Count());
        Assert.Equal(17, Norms.Count(norm => norm.GetProperty("needsReview").GetBoolean()));
        Assert.Equal(["nap_minutes", "wake_window_minutes"], Metrics.Where(metric => !IsNull(metric, "missingReason")).Select(metric => Str(metric, "key")).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Metrics_HaveUniqueKeysAllowedUnitsAndNormsUnlessMissing()
    {
        var problems = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var metric in Metrics)
        {
            var key = Str(metric, "key");
            Check(problems, SnakeCase().IsMatch(key), $"metric '{key}' is not a snake_case key");
            Check(problems, seen.Add(key), $"metric '{key}' is listed twice");
            Check(problems, Units.Contains(Str(metric, "unit")), $"metric '{key}' has unit '{Str(metric, "unit")}' outside the allowed set");
            Check(problems, !string.IsNullOrWhiteSpace(Str(metric, "description")), $"metric '{key}' has no description");
            var normCount = Norms.Count(norm => Str(norm, "metric") == key);
            var missing = !IsNull(metric, "missingReason");
            Check(problems, missing ? normCount == 0 : normCount > 0, missing ? $"metric '{key}' is marked missing but has norms" : $"metric '{key}' has no norm and no missingReason");
        }

        Assert.Empty(problems);
    }

    [Fact]
    public void Sources_AreCompleteUniqueAndUsed()
    {
        var problems = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var used = Norms.SelectMany(norm => Strings(norm.GetProperty("sourceIds"))).ToHashSet(StringComparer.Ordinal);
        foreach (var source in Sources)
        {
            var id = Str(source, "id");
            Check(problems, Slug().IsMatch(id), $"source id '{id}' is not a lower-case slug");
            Check(problems, seen.Add(id), $"source '{id}' is listed twice");
            foreach (var field in new[] { "kind", "country", "citation", "licence", "licenceNote" })
            {
                Check(problems, !string.IsNullOrWhiteSpace(Str(source, field)), $"source '{id}' has no {field}");
            }

            Check(problems, Str(source, "url").StartsWith("https://", StringComparison.Ordinal), $"source '{id}' has no https url");
            Check(problems, DateOnly.TryParseExact(Str(source, "accessedOn"), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _), $"source '{id}' has no accessedOn date");
            Check(problems, used.Contains(id), $"source '{id}' is not used by any norm");
        }

        Assert.Empty(problems);
    }

    [Fact]
    public void Norms_AreWellFormed()
    {
        var problems = new List<string>();
        var metricUnits = Metrics.ToDictionary(metric => Str(metric, "key"), metric => Str(metric, "unit"), StringComparer.Ordinal);
        var sourceIds = Sources.Select(source => Str(source, "id")).ToHashSet(StringComparer.Ordinal);
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var norm in Norms)
        {
            var id = Str(norm, "id");
            var metric = Str(norm, "metric");
            var population = Str(norm, "population");
            var band = norm.GetProperty("ageBand");
            var from = band.GetProperty("fromDays").GetInt32();
            var to = band.GetProperty("toDays").GetInt32();
            Check(problems, ids.Add(id), $"norm id '{id}' is used twice");
            Check(problems, id == $"{metric}.{population}.{from}-{to}", $"norm '{id}' is not named metric.population.fromDays-toDays");
            Check(problems, metricUnits.ContainsKey(metric), $"norm '{id}' has unknown metric '{metric}'");
            Check(problems, metricUnits.GetValueOrDefault(metric) == Str(norm, "unit"), $"norm '{id}' has unit '{Str(norm, "unit")}', its metric uses '{metricUnits.GetValueOrDefault(metric)}'");
            Check(problems, Populations.Contains(population), $"norm '{id}' has unknown population '{population}'");
            Check(problems, from >= 0 && to > from, $"norm '{id}' has an empty or negative age band");
            Check(problems, band.GetProperty("fromWeeks").GetDecimal() == Math.Round(from / 7m, 2) && band.GetProperty("toWeeks").GetDecimal() == Math.Round(to / 7m, 2), $"norm '{id}' has weeks that do not match its days");
            Check(problems, !string.IsNullOrWhiteSpace(Str(band, "label")), $"norm '{id}' has no band label");
            CheckOrder(problems, id, Num(norm, "low"), Num(norm, "typical"), Num(norm, "high"));
            Check(problems, Confidences.Contains(Str(norm, "confidence")), $"norm '{id}' has confidence '{Str(norm, "confidence")}'");
            var needsReview = norm.GetProperty("needsReview").GetBoolean();
            Check(problems, needsReview == !string.IsNullOrWhiteSpace(Str(norm, "needsReviewReason")), $"norm '{id}' needs a review reason exactly when needsReview is true");
            var listed = Strings(norm.GetProperty("sourceIds"));
            var cited = norm.GetProperty("evidence").EnumerateArray().Select(item => Str(item, "sourceId")).Distinct(StringComparer.Ordinal).ToArray();
            Check(problems, listed.Length > 0, $"norm '{id}' cites no source");
            Check(problems, listed.All(sourceIds.Contains), $"norm '{id}' cites a source that is not in sources[]");
            Check(problems, listed.SequenceEqual(cited), $"norm '{id}' sourceIds [{string.Join(",", listed)}] differ from its evidence [{string.Join(",", cited)}]");
        }

        Assert.Empty(problems);
    }

    [Fact]
    public void Evidence_IsWellFormed()
    {
        var problems = new List<string>();
        foreach (var norm in Norms)
        {
            var id = Str(norm, "id");
            foreach (var item in norm.GetProperty("evidence").EnumerateArray())
            {
                var where = $"norm '{id}' evidence from '{Str(item, "sourceId")}'";
                Check(problems, !string.IsNullOrWhiteSpace(Str(item, "location")) && !string.IsNullOrWhiteSpace(Str(item, "sourceAge")), $"{where} has no location or source age");
                var (low, typical, high) = (Num(item, "low"), Num(item, "typical"), Num(item, "high"));
                CheckOrder(problems, where, low, typical, high);
                var hasRange = low is not null || high is not null;
                Check(problems, hasRange ? RangeKinds.Contains(Str(item, "rangeKind")) : IsNull(item, "rangeKind"), $"{where} needs a known rangeKind exactly when it gives a low or a high");
                Check(problems, typical is not null ? TypicalKinds.Contains(Str(item, "typicalKind")) : IsNull(item, "typicalKind"), $"{where} needs a known typicalKind exactly when it gives a typical");
                Check(problems, Num(item, "sd") is null or > 0m,$"{where} has a non-positive sd");
            }
        }

        Assert.Empty(problems);
    }

    [Fact]
    public void MergedValues_FollowTheMergeRule()
    {
        var problems = new List<string>();
        foreach (var norm in Norms)
        {
            var id = Str(norm, "id");
            var evidence = norm.GetProperty("evidence").EnumerateArray().ToArray();
            var typicals = evidence.Select(item => Num(item, "typical")).OfType<decimal>().ToArray();
            var lows = evidence.Select(item => Num(item, "low")).OfType<decimal>().ToArray();
            var highs = evidence.Select(item => Num(item, "high")).OfType<decimal>().ToArray();
            decimal? expectedLow = lows.Length > 0 ? lows.Concat(typicals).Min() : null;
            decimal? expectedHigh = highs.Length > 0 ? highs.Concat(typicals).Max() : null;
            Check(problems, Num(norm, "low") == expectedLow, $"norm '{id}' low {Num(norm, "low")} is not the smallest evidence value {expectedLow}");
            Check(problems, Num(norm, "high") == expectedHigh, $"norm '{id}' high {Num(norm, "high")} is not the largest evidence value {expectedHigh}");

            var typical = Num(norm, "typical");
            if (IsNull(norm, "typicalSourceId"))
            {
                Check(problems, typical is null && typicals.Length == 0, $"norm '{id}' has no typicalSourceId but a typical value is published or set");
                continue;
            }

            var typicalSource = Str(norm, "typicalSourceId");
            Check(problems, evidence.Any(item => Str(item, "sourceId") == typicalSource && Num(item, "typical") == typical), $"norm '{id}' typical {typical} does not come from '{typicalSource}'");
        }

        Assert.Empty(problems);
    }

    [Fact]
    public void Bands_DoNotOverlapPerMetricAndPopulation()
    {
        var problems = new List<string>();
        foreach (var group in Norms.GroupBy(norm => $"{Str(norm, "metric")}/{Str(norm, "population")}", StringComparer.Ordinal))
        {
            var bands = group
                .Select(norm => (Id: Str(norm, "id"), From: norm.GetProperty("ageBand").GetProperty("fromDays").GetInt32(), To: norm.GetProperty("ageBand").GetProperty("toDays").GetInt32()))
                .OrderBy(band => band.From)
                .ToArray();
            for (var index = 1; index < bands.Length; index++)
            {
                Check(problems, bands[index - 1].To <= bands[index].From, $"'{bands[index - 1].Id}' overlaps '{bands[index].Id}'");
            }
        }

        Assert.Empty(problems);
    }

    [Fact]
    public void Lookup_ByAgeAndPopulation_FindsOneBand()
    {
        // How the wiring task reads the file: the band whose [fromDays, toDays) holds the age in completed days.
        var threeMonthOld = Norms.Where(norm => Str(norm, "metric") == "total_sleep_hours_24h" && Str(norm, "population") == "all" && InBand(norm, 100)).ToArray();
        var newbornWet = Norms.Where(norm => Str(norm, "metric") == "wet_diapers_per_24h" && Str(norm, "population") == "breastfed" && InBand(norm, 6)).ToArray();

        var sleep = Assert.Single(threeMonthOld);
        Assert.Equal(8.35m, Num(sleep, "low"));
        Assert.Equal(13m, Num(sleep, "typical"));
        Assert.Equal(19.5m, Num(sleep, "high"));
        Assert.Equal("pelotas-2017", Str(sleep, "typicalSourceId"));
        Assert.Equal(6m, Num(Assert.Single(newbornWet), "low"));
    }

    private static bool InBand(JsonElement norm, int ageDays) =>
        norm.GetProperty("ageBand").GetProperty("fromDays").GetInt32() <= ageDays && ageDays < norm.GetProperty("ageBand").GetProperty("toDays").GetInt32();

    private static void CheckOrder(List<string> problems, string where, decimal? low, decimal? typical, decimal? high)
    {
        Check(problems, low is not null || typical is not null || high is not null, $"{where} gives no value");
        Check(problems, low is null || typical is null || low <= typical, $"{where} low {low} is above typical {typical}");
        Check(problems, typical is null || high is null || typical <= high, $"{where} typical {typical} is above high {high}");
        Check(problems, low is null || high is null || low <= high, $"{where} low {low} is above high {high}");
    }

    private static void Check(List<string> problems, bool condition, string problem)
    {
        if (!condition)
        {
            problems.Add(problem);
        }
    }

    private static string Str(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : string.Empty;

    private static bool IsNull(JsonElement element, string property) =>
        !element.TryGetProperty(property, out var value) || value.ValueKind == JsonValueKind.Null;

    private static decimal? Num(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDecimal() : null;

    private static string[] Strings(JsonElement array) => array.EnumerateArray().Select(item => item.GetString() ?? string.Empty).ToArray();

    [GeneratedRegex("^[a-z][a-z0-9]*(_[a-z0-9]+)*$")]
    private static partial Regex SnakeCase();

    [GeneratedRegex("^[a-z0-9]+(-[a-z0-9]+)*$")]
    private static partial Regex Slug();
}
