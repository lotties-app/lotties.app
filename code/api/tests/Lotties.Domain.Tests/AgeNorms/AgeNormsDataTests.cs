using Lotties.Domain.AgeNorms;

namespace Lotties.Domain.Tests.AgeNorms;

/// <summary>
/// The published age norms as shipped (code/api/data/age-norms.json, linked into the test output and embedded in
/// Lotties.Application; docs/design/28-age-norms.md section 11): canonical text, every rule of
/// <see cref="AgeNormsValidator"/> (the same rules the API checks at startup) and the research counts, pinned on purpose.
/// </summary>
public sealed class AgeNormsDataTests
{
    [Fact]
    public void File_IsCanonicalJsonWithTheSchemaHeader()
    {
        // Git for Windows may check the file out with CRLF (no .gitattributes), so line endings are not asserted.
        Assert.EndsWith("}\n", ShippedAgeNorms.Text.Replace("\r\n", "\n", StringComparison.Ordinal), StringComparison.Ordinal);
        Assert.Equal(AgeNormSet.SupportedSchemaVersion, ShippedAgeNorms.Set.SchemaVersion);
    }

    [Fact]
    public void File_FollowsEveryValidatorRule()
    {
        Assert.Empty(AgeNormsValidator.Validate(ShippedAgeNorms.Set));
    }

    [Fact]
    public void File_KeepsTheResearchCounts()
    {
        // Pinned on purpose: change these with the data and with docs/design/28-age-norms.md.
        var norms = ShippedAgeNorms.Set;
        Assert.Equal(18, norms.Sources.Count);
        Assert.Equal(22, norms.Metrics.Count);
        Assert.Equal(91, norms.Norms.Count);
        Assert.Equal(17, norms.Norms.Count(norm => norm.NeedsReview));
        Assert.Equal(7, norms.Norms.Count(norm => norm.Confidence == AgeNormConfidence.Low));
        Assert.Equal(["nap_minutes", "wake_window_minutes"], norms.Metrics.Where(metric => metric.MissingReason is not null).Select(metric => metric.Key).Order(StringComparer.Ordinal));
    }

    [Fact]
    public void For_ByAgeAndPopulation_FindsOneBand()
    {
        var sleep = ShippedAgeNorms.Set.For("total_sleep_hours_24h", AgeNormPopulations.All, 100);
        var newbornWet = ShippedAgeNorms.Set.For("wet_diapers_per_24h", AgeNormPopulations.Breastfed, 6);

        Assert.NotNull(sleep);
        Assert.Equal((8.35m, 13m, 19.5m, "pelotas-2017"), (sleep!.Low, sleep.Typical, sleep.High, sleep.TypicalSourceId));
        Assert.Equal(6m, newbornWet?.Low);
    }
}

/// <summary>The shipped file, read once for every test class.</summary>
internal static class ShippedAgeNorms
{
    private static readonly Lazy<string> LazyText = new(() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "AgeNorms", "age-norms.json")));

    private static readonly Lazy<AgeNormSet> LazySet = new(() => AgeNormsJson.Parse(LazyText.Value));

    public static string Text => LazyText.Value;

    public static AgeNormSet Set => LazySet.Value;
}
