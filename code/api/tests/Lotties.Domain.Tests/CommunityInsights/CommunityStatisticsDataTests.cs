using Lotties.Domain.CommunityInsights;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The community statistics catalog as shipped (code/api/data/community-statistics.json, linked into the test output and
/// embedded in Lotties.Application; docs/design/34-community-insights.md, T4): canonical text, every validator rule, exactly
/// the use cases of section 4, no forbidden input, and the proposed values of section 13.
/// </summary>
public sealed class CommunityStatisticsDataTests
{
    /// <summary>Section 4's use cases, written out here on purpose (not taken from the validator) so a drift on either side fails.</summary>
    private static readonly string[] Section4UseCases =
    [
        "bottle_ml_per_feed", "growth_vs_age", "tummy_minutes_per_day", "naps_per_day", "day_sleep_minutes",
        "night_sleep_minutes", "feeds_per_day", "diapers_per_day", "routine_shift_scale", "cry_outcome_by_cause",
    ];

    [Fact]
    public void File_IsCanonicalJsonWithTheSchemaHeader()
    {
        var catalog = ShippedCommunityStatistics.Catalog;

        Assert.EndsWith("}\n", ShippedCommunityStatistics.Text.Replace("\r\n", "\n", StringComparison.Ordinal), StringComparison.Ordinal);
        Assert.Equal((2, 2, "catalog only, not collected"), (catalog.Schema, catalog.Version, catalog.GeneratedFor));
    }

    [Fact]
    public void File_FollowsEveryValidatorRule()
    {
        Assert.Empty(CommunityStatisticsValidator.Validate(ShippedCommunityStatistics.Catalog));
    }

    [Fact]
    public void File_HasOneEntryPerSection4UseCaseAndNothingElse()
    {
        var keys = ShippedCommunityStatistics.Catalog.Statistics.Select(statistic => statistic.Key).ToArray();

        Assert.Equal(Section4UseCases, keys);
        Assert.Equal(Section4UseCases.Order(StringComparer.Ordinal), CommunityStatisticsValidator.KnownKeys.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void File_NoInputReadsAForbiddenCategory()
    {
        var inputs = ShippedCommunityStatistics.Catalog.Statistics.SelectMany(statistic => statistic.Inputs).Distinct(StringComparer.Ordinal).ToArray();

        Assert.All(inputs, input => Assert.Empty(CommunityStatisticsValidator.ForbiddenCategoriesOf(input)));
        Assert.All(CommunityStatisticsValidator.AllowedInputs, input => Assert.Empty(CommunityStatisticsValidator.ForbiddenCategoriesOf(input)));
    }

    [Fact]
    public void File_UsesTheProposedValuesOfSection13()
    {
        var statistics = ShippedCommunityStatistics.Catalog.Statistics;

        Assert.Equal("quarterly", ShippedCommunityStatistics.Catalog.Release);
        Assert.All(statistics, statistic => Assert.Equal((20, "planned", true), (statistic.K, statistic.Status, statistic.Proposed)));
        Assert.All(statistics.Where(statistic => statistic.KTails is not null), statistic => Assert.Equal(50, statistic.KTails));
        // O6 keeps pooled growth out; O2 (design 34 section 5.1) defers every percentile output: only the crying shares and the
        // tummy-time statistic (its share of days) stay candidates for v1.
        Assert.Equal(
            ["growth_vs_age", "feeds_per_day", "diapers_per_day", "routine_shift_scale"],
            statistics.Where(statistic => statistic.NotInV1).Select(statistic => statistic.Key));
    }

    [Fact]
    public void File_CarriesTheNoiseTiersOfSection51()
    {
        var statistics = ShippedCommunityStatistics.Catalog.Statistics;

        // Tier A (strict, 0.2): the crying shares; tier B (relaxed, about 5): the tummy-time share of days; tier C (2026-11-27): p25,
        // p50 and p75 of formula bottles and the three sleep routines, epsilon 2 per cell, at most 4 cells (8 per release).
        string[] quartiles = ["p25:C", "p50:C", "p75:C"];
        Assert.Equal(
            [
                .. quartiles.Select(output => $"bottle_ml_per_feed.{output}"), "tummy_minutes_per_day.share_of_days_with_any:B",
                .. quartiles.Select(output => $"naps_per_day.{output}"), .. quartiles.Select(output => $"day_sleep_minutes.{output}"),
                .. quartiles.Select(output => $"night_sleep_minutes.{output}"), "cry_outcome_by_cause.share_helped_by_cause:A",
            ],
            statistics.SelectMany(statistic => statistic.V1Outputs.Select(output => $"{statistic.Key}.{output.Name}:{output.Tier}")));
        Assert.Equal(
            [("bottle_ml_per_feed", 8m), ("tummy_minutes_per_day", 5m), ("naps_per_day", 8m), ("day_sleep_minutes", 8m), ("night_sleep_minutes", 8m), ("cry_outcome_by_cause", 0.2m)],
            statistics.Where(statistic => statistic.Epsilon is not null).Select(statistic => (statistic.Key, statistic.Epsilon!.Value)));
        Assert.All(statistics.SelectMany(statistic => statistic.Outputs).Where(output => CommunityOutputs.Percentiles.Contains(output.Name) && !CommunityOutputs.Quantiles.Contains(output.Name)), output => Assert.Equal(CommunityOutputTier.NotInV1, output.Tier));
    }

    [Fact]
    public void File_Percentiles_AreTheBoundedOptionA_AsTheStudyMeasuredIt()
    {
        var percentiles = ShippedCommunityStatistics.Catalog.Statistics.Where(statistic => statistic.V1Outputs.Any(output => output.Tier == CommunityOutputTier.C)).ToArray();

        Assert.Equal(["bottle_ml_per_feed", "naps_per_day", "day_sleep_minutes", "night_sleep_minutes"], percentiles.Select(statistic => statistic.Key));
        Assert.All(percentiles, statistic => Assert.Equal((4, "previous_quarter", "age_weeks_4", (string?)null, 14), (statistic.MaxCellsPerBaby!.Value, statistic.Window!, statistic.Band.Grid, statistic.Band.Dimension, statistic.CapPerBaby)));
        Assert.Equal(
            [("bottle_drunk_ml", 0m, 400m, 20m, 10m), ("naps_per_day", 0m, 8m, 0.5m, 0.5m), ("day_sleep_minutes", 0m, 720m, 30m, 10m), ("night_sleep_minutes", 0m, 960m, 30m, 10m)],
            percentiles.Select(statistic => (statistic.Clip.Single().Input, statistic.Clip.Single().Min, statistic.Clip.Single().Max, statistic.Histogram!.BinWidth, statistic.Histogram.Step)));
        Assert.Equal([new CommunityBandSegment(0, 104, 4)], ShippedCommunityStatistics.Catalog.BandGrids.AgeWeeks4);
    }

    [Fact]
    public void File_Crying_IsOneOutputWithNoDimension_ReadingOnlyWhatItUses()
    {
        var cry = ShippedCommunityStatistics.Catalog.Statistics.Single(statistic => statistic.Key == "cry_outcome_by_cause");

        // Owner decision of 2026-11-27: the share each cause helped only, no part of day; the published list does not over-declare.
        Assert.Equal(["age_weeks", "local_day", "what_helped_cause"], cry.Inputs);
        Assert.Null(cry.Band.Dimension);
        Assert.Equal([CommunityOutputs.ShareHelpedByCause], cry.V1Outputs.Select(output => output.Name));
    }

    [Fact]
    public void File_CryBandsAreTheFourCryAgeBandsOnWeekEdges()
    {
        Assert.Equal(
            [new("newborn", 0, 6), new("weeks6to3m", 6, 13), new("months3to6", 13, 26), new CommunityNamedBand("months6plus", 26, 104)],
            ShippedCommunityStatistics.Catalog.BandGrids.CryAgeBands);
    }

    [Fact]
    public void Parse_UnknownTier_IsAFormatException()
    {
        var unknownTier = ShippedCommunityStatistics.Text.Replace("\"tier\": \"B\"", "\"tier\": \"D\"", StringComparison.Ordinal);

        Assert.Throws<FormatException>(() => CommunityStatisticsJson.Parse(unknownTier));
    }

    [Fact]
    public void Parse_MissingProperty_IsAFormatException()
    {
        var withoutK = ShippedCommunityStatistics.Text.Replace("\"k\": 20,", string.Empty, StringComparison.Ordinal);

        Assert.Throws<FormatException>(() => CommunityStatisticsJson.Parse(withoutK));
    }

    [Fact]
    public void Parse_UnknownProperty_IsAFormatException()
    {
        var withExtra = ShippedCommunityStatistics.Text.Replace("\"k\": 20,", "\"k\": 20, \"birthDate\": \"2026-01-01\",", StringComparison.Ordinal);

        Assert.Throws<FormatException>(() => CommunityStatisticsJson.Parse(withExtra));
    }

    [Fact]
    public void Parse_NullWhereNotAllowed_IsAFormatException()
    {
        var nullDescription = ShippedCommunityStatistics.Text.Replace("\"description\": \"Naps per complete local day, by age in 4-week bands, from the previous calendar quarter.\"", "\"description\": null", StringComparison.Ordinal);

        Assert.Throws<FormatException>(() => CommunityStatisticsJson.Parse(nullDescription));
    }
}

/// <summary>The shipped catalog, read once for every test class.</summary>
internal static class ShippedCommunityStatistics
{
    private static readonly Lazy<string> LazyText = new(() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "CommunityInsights", "community-statistics.json")));

    private static readonly Lazy<CommunityStatisticsCatalog> LazyCatalog = new(() => CommunityStatisticsJson.Parse(LazyText.Value));

    public static string Text => LazyText.Value;

    public static CommunityStatisticsCatalog Catalog => LazyCatalog.Value;
}
