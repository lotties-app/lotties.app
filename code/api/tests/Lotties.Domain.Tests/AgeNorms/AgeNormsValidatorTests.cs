using Lotties.Domain.AgeNorms;

namespace Lotties.Domain.Tests.AgeNorms;

/// <summary>
/// Each rule of <see cref="AgeNormsValidator"/> (the API refuses to start on a broken file): the shipped file with one
/// thing broken must report exactly that problem.
/// </summary>
public sealed class AgeNormsValidatorTests
{
    private const string SleepNorm = "total_sleep_hours_24h.all.0-91";
    private const string VolumeNorm = "feed_volume_ml_per_feed.formula.30-61";

    private static AgeNormSet Valid => ShippedAgeNorms.Set;

    private static AgeNormSet With(
        AgeNormSet set,
        int? schemaVersion = null,
        string? purpose = null,
        IReadOnlyList<string>? units = null,
        IReadOnlyList<AgeNormMetric>? metrics = null,
        IReadOnlyList<AgeNormSource>? sources = null,
        IReadOnlyList<AgeNorm>? norms = null) =>
        new(
            schemaVersion ?? set.SchemaVersion,
            set.GeneratedAt,
            purpose ?? set.Purpose,
            units ?? set.Units,
            set.Populations,
            set.RangeKinds,
            set.TypicalKinds,
            metrics ?? set.Metrics,
            sources ?? set.Sources,
            norms ?? set.Norms);

    private static AgeNormSet WithNorm(string id, Func<AgeNorm, AgeNorm> change) =>
        With(Valid, norms: Valid.Norms.Select(norm => norm.Id == id ? change(norm) : norm).ToArray());

    private static AgeNormSet WithEvidence(string id, Func<AgeNormEvidence, AgeNormEvidence> change) =>
        WithNorm(id, norm => norm with { Evidence = norm.Evidence.Select((item, index) => index == 0 ? change(item) : item).ToArray() });

    private static void AssertReports(AgeNormSet set, string expected)
    {
        var errors = AgeNormsValidator.Validate(set);
        Assert.Contains(errors, error => error.Contains(expected, StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_ShippedFile_HasNoError()
    {
        Assert.Empty(AgeNormsValidator.Validate(Valid));
        Assert.Same(Valid, AgeNormsValidator.EnsureValid(Valid));
    }

    [Fact]
    public void Validate_Header_ChecksSchemaPurposeAndVocabularies()
    {
        AssertReports(With(Valid, schemaVersion: 2), "schemaVersion must be 1.");
        AssertReports(With(Valid, purpose: " "), "purpose is required.");
        AssertReports(With(Valid, units: ["hours"]), "units must be [");
    }

    [Fact]
    public void Validate_Metrics_ChecksKeysUnitsAndMissingNorms()
    {
        var first = Valid.Metrics[0];
        AssertReports(With(Valid, metrics: [.. Valid.Metrics, first]), $"metric '{first.Key}' is listed twice.");
        AssertReports(With(Valid, metrics: Valid.Metrics.Select(metric => metric == first ? metric with { Unit = "litres" } : metric).ToArray()), "outside the allowed set");
        AssertReports(With(Valid, metrics: Valid.Metrics.Select(metric => metric == first ? metric with { MissingReason = "none found" } : metric).ToArray()), "is marked missing but has norms");
        AssertReports(With(Valid, metrics: [.. Valid.Metrics, new AgeNormMetric("Bad-Key", "hours", "x", null)]), "metric 'Bad-Key' is not a snake_case key.");
        AssertReports(With(Valid, metrics: [.. Valid.Metrics, new AgeNormMetric("orphan_metric", "hours", "x", null)]), "metric 'orphan_metric' has no norm and no missingReason.");
    }

    [Fact]
    public void Validate_Sources_ChecksSlugsUrlsLicencesAndUse()
    {
        var first = Valid.Sources[0];
        AssertReports(With(Valid, sources: Valid.Sources.Select(source => source == first ? source with { Url = "http://example.org" } : source).ToArray()), $"source '{first.Id}' has no https url.");
        AssertReports(With(Valid, sources: Valid.Sources.Select(source => source == first ? source with { Licence = "" } : source).ToArray()), "needs a kind, country, citation, licence and licenceNote.");
        AssertReports(With(Valid, sources: [.. Valid.Sources, first with { Id = "unused-2026" }]), "source 'unused-2026' is not used by any norm.");
        AssertReports(With(Valid, sources: [.. Valid.Sources, first]), $"source '{first.Id}' is listed twice.");
    }

    [Fact]
    public void Validate_Norms_ChecksIdsBandsValuesAndFlags()
    {
        AssertReports(WithNorm(SleepNorm, norm => norm with { Id = "sleep" }), "norm 'sleep' is not named metric.population.fromDays-toDays.");
        AssertReports(WithNorm(SleepNorm, norm => norm with { Population = "twins" }), "unknown population 'twins'");
        AssertReports(WithNorm(SleepNorm, norm => norm with { Unit = "minutes" }), "has unit 'minutes', its metric uses 'hours'");
        AssertReports(WithNorm(SleepNorm, norm => norm with { Band = norm.Band with { ToWeeks = 12 } }), $"norm '{SleepNorm}' has weeks that do not match its days.");
        AssertReports(WithNorm(SleepNorm, norm => norm with { Low = 30 }), $"norm '{SleepNorm}' low 30 is above typical");
        AssertReports(WithNorm(SleepNorm, norm => norm with { Confidence = "certain" }), "has confidence 'certain'");
        AssertReports(WithNorm(SleepNorm, norm => norm with { NeedsReview = true }), "needs a review reason exactly when needsReview is true.");
        AssertReports(WithNorm(SleepNorm, norm => norm with { SourceIds = ["nsf-2015", "galland-2012"] }), "differ from its evidence");
        AssertReports(WithNorm(SleepNorm, norm => norm with { SourceIds = ["nobody"] }), "cites a source that is not in sources[].");
    }

    [Fact]
    public void Validate_Evidence_ChecksKindsAndSd()
    {
        AssertReports(WithEvidence(SleepNorm, item => item with { RangeKind = null }), "needs a known rangeKind exactly when it gives a low or a high.");
        AssertReports(WithEvidence(SleepNorm, item => item with { TypicalKind = "guess" }), "needs a known typicalKind exactly when it gives a typical.");
        AssertReports(WithEvidence(SleepNorm, item => item with { Sd = 0 }), "has a non-positive sd.");
        AssertReports(WithEvidence(SleepNorm, item => item with { Location = "" }), "has no location or source age.");
    }

    [Fact]
    public void Validate_MergeRule_ChecksLowHighAndTypicalSource()
    {
        AssertReports(WithNorm(VolumeNorm, norm => norm with { Low = 100 }), $"norm '{VolumeNorm}' low 100 is not the smallest evidence value 90.");
        AssertReports(WithNorm(VolumeNorm, norm => norm with { High = 140 }), $"norm '{VolumeNorm}' high 140 is not the largest evidence value 150.");
        AssertReports(WithNorm(VolumeNorm, norm => norm with { Typical = 120 }), $"norm '{VolumeNorm}' typical 120 does not come from");
        AssertReports(WithNorm(SleepNorm, norm => norm with { Typical = 15 }), $"norm '{SleepNorm}' typical 15 does not come from 'galland-2012'");
    }

    [Fact]
    public void Validate_Bands_MustNotOverlapPerMetricAndPopulation()
    {
        var overlapping = Valid.Norms.Single(norm => norm.Id == SleepNorm) with { Id = "total_sleep_hours_24h.all.80-100", Band = new AgeNormBand(80, 100, 11.43m, 14.29m, "overlap") };

        AssertReports(With(Valid, norms: [.. Valid.Norms, overlapping]), $"'{SleepNorm}' overlaps 'total_sleep_hours_24h.all.80-100'.");
    }

    [Fact]
    public void EnsureValid_BrokenFile_ThrowsListingEveryRule()
    {
        var error = Assert.Throws<InvalidOperationException>(() => AgeNormsValidator.EnsureValid(With(Valid, schemaVersion: 3, purpose: "")));

        Assert.Contains("schemaVersion must be 1.", error.Message, StringComparison.Ordinal);
        Assert.Contains("purpose is required.", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_MissingProperty_NamesItsPath()
    {
        var error = Assert.Throws<FormatException>(() => AgeNormsJson.Parse("{\"schemaVersion\": 1, \"generatedAt\": \"2026-10-23\"}"));

        Assert.Contains("$.purpose is missing.", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Parse_NotJson_IsAFormatException()
    {
        Assert.Throws<FormatException>(() => AgeNormsJson.Parse("{"));
    }
}
