using Lotties.Domain.CommunityInsights;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// Each rule of <see cref="CommunityStatisticsValidator"/> (the API refuses to start on a broken catalog): the shipped
/// catalog with one thing broken must report that problem.
/// </summary>
public sealed class CommunityStatisticsValidatorTests
{
    private const string Bottle = "bottle_ml_per_feed";
    private const string Growth = "growth_vs_age";
    private const string Naps = "naps_per_day";
    private const string Tummy = "tummy_minutes_per_day";
    private const string Cry = "cry_outcome_by_cause";

    private static CommunityStatisticsCatalog Valid => ShippedCommunityStatistics.Catalog;

    private static CommunityStatisticsCatalog WithStatistic(string key, Func<CommunityStatistic, CommunityStatistic> change) =>
        Valid with { Statistics = Valid.Statistics.Select(statistic => statistic.Key == key ? change(statistic) : statistic).ToArray() };

    private static CommunityStatisticsCatalog WithGrids(Func<CommunityBandGrids, CommunityBandGrids> change) =>
        Valid with { BandGrids = change(Valid.BandGrids) };

    private static CommunityStatistic WithTier(CommunityStatistic statistic, string output, CommunityOutputTier tier) =>
        statistic with { Outputs = [.. statistic.Outputs.Select(entry => entry.Name == output ? entry with { Tier = tier } : entry)] };

    private static void AssertReports(CommunityStatisticsCatalog catalog, string expected)
    {
        var errors = CommunityStatisticsValidator.Validate(catalog);
        Assert.Contains(errors, error => error.Contains(expected, StringComparison.Ordinal));
    }

    [Fact]
    public void Validate_ShippedCatalog_HasNoError()
    {
        Assert.Empty(CommunityStatisticsValidator.Validate(Valid));
        Assert.Same(Valid, CommunityStatisticsValidator.EnsureValid(Valid));
    }

    [Fact]
    public void EnsureValid_BrokenCatalog_ThrowsListingTheRule()
    {
        var broken = WithStatistic(Naps, statistic => statistic with { K = 5 });

        var exception = Assert.Throws<InvalidOperationException>(() => CommunityStatisticsValidator.EnsureValid(broken));
        Assert.Contains("k 5 is below 20", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_Header_ChecksSchemaVersionGeneratedForAndRelease()
    {
        AssertReports(Valid with { Schema = 1 }, "schema must be 2.");
        AssertReports(Valid with { Version = 0 }, "version must be 1 or more.");
        AssertReports(Valid with { GeneratedFor = "collected" }, "generatedFor must be 'catalog only, not collected'.");
        AssertReports(Valid with { Release = "nightly" }, "release 'nightly' must be one of");
        AssertReports(Valid with { Release = "weekly" }, "release 'weekly' must be one of [quarterly]");
    }

    [Fact]
    public void Validate_Grids_ChecksContiguityStepsEdgesAndCryBands()
    {
        AssertReports(WithGrids(grids => grids with { AgeWeeksFine = [new(0, 12, 1), new(14, 104, 2)] }), "ageWeeksFine segments must be contiguous.");
        AssertReports(WithGrids(grids => grids with { AgeWeeksFine = [new(1, 104, 1)] }), "ageWeeksFine must start at week 0.");
        AssertReports(WithGrids(grids => grids with { AgeWeeksCoarse = [new(0, 52, 4)] }), "ageWeeksCoarse must end at week 104.");
        AssertReports(WithGrids(grids => grids with { AgeWeeksCoarse = [new(0, 104, 5)] }), "ageWeeksCoarse segments must have a positive step that divides them.");
        AssertReports(WithGrids(grids => grids with { AgeWeeksCoarse = [new(0, 2, 2), new(2, 104, 6)] }), "every ageWeeksCoarse edge must be an ageWeeksFine edge.");
        AssertReports(WithGrids(grids => grids with { CryAgeBands = [new("newborn", 0, 104)] }), "cryAgeBands must be [");
        AssertReports(WithGrids(grids => grids with { CryAgeBands = [new("newborn", 0, 6), new("weeks6to3m", 6, 13), new("months3to6", 14, 26), new("months6plus", 26, 104)] }), "cryAgeBands must be non-empty and contiguous.");
        AssertReports(WithGrids(grids => grids with { CryAgeBands = [new("newborn", 0, 6), new("weeks6to3m", 6, 13), new("months3to6", 13, 26), new("months6plus", 26, 52)] }), "cryAgeBands must run from week 0 to week 104.");
    }

    [Fact]
    public void Validate_UnknownKey_IsRejected()
    {
        var unknown = Valid.Statistics[0] with { Key = "bottle_brand_share" };

        AssertReports(Valid with { Statistics = [.. Valid.Statistics, unknown] }, "statistic 'bottle_brand_share' is not a use case of section 4.");
    }

    [Fact]
    public void Validate_DuplicateKey_IsRejected()
    {
        AssertReports(Valid with { Statistics = [.. Valid.Statistics, Valid.Statistics[0]] }, $"statistic '{Bottle}' is listed twice.");
    }

    [Fact]
    public void Validate_MissingUseCase_IsRejected()
    {
        AssertReports(Valid with { Statistics = Valid.Statistics.Where(statistic => statistic.Key != Naps).ToArray() }, $"statistic '{Naps}' is missing.");
    }

    [Fact]
    public void Validate_KBelow20_IsRejected()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { K = 19 }), "k 19 is below 20.");
    }

    [Fact]
    public void Validate_TailsWithoutKTails50_AreRejected()
    {
        AssertReports(WithStatistic(Growth, statistic => statistic with { KTails = 30 }), "needs kTails of at least 50 exactly when it publishes p3/p97.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Outputs = [.. statistic.Outputs, new("p97", CommunityOutputTier.NotInV1)] }), "needs kTails of at least 50");
        AssertReports(WithStatistic(Naps, statistic => statistic with { KTails = 50 }), "needs kTails of at least 50");
    }

    [Fact]
    public void Validate_InputOutsideTheAllowList_IsRejected()
    {
        AssertReports(WithStatistic(Bottle, statistic => statistic with { Inputs = [.. statistic.Inputs, "formula_brand"] }), "input 'formula_brand' is not in the allowed inputs.");
    }

    [Theory]
    [InlineData("baby_name", "names")]
    [InlineData("birth_date", "birth date")]
    [InlineData("event_timestamp", "event timestamps")]
    [InlineData("note_text", "notes")]
    [InlineData("custom_field_value", "custom text")]
    [InlineData("medication_dose", "medications")]
    [InlineData("prescription_id", "prescriptions")]
    [InlineData("vaccine_code", "vaccines")]
    [InlineData("symptom_kind", "symptoms")]
    [InlineData("temperature_c", "temperatures")]
    [InlineData("appointment_count", "appointments")]
    [InlineData("care_provider_id", "care providers")]
    [InlineData("member_role", "members")]
    [InlineData("doctor_specialty", "doctor data")]
    [InlineData("push_endpoint", "push")]
    [InlineData("assistant_intent", "assistant data")]
    [InlineData("account_email", "account")]
    public void Validate_InputOfAForbiddenCategory_IsRejected(string input, string category)
    {
        AssertReports(WithStatistic(Bottle, statistic => statistic with { Inputs = [.. statistic.Inputs, input] }), $"input '{input}' reads a forbidden category ({category}).");
    }

    [Fact]
    public void Validate_EpsilonOutOfItsTierRange_IsRejected()
    {
        AssertReports(WithStatistic(Cry, statistic => statistic with { Epsilon = 0m }), "is out of the tier A range (0, 1]");
        AssertReports(WithStatistic(Cry, statistic => statistic with { Epsilon = 5m }), "is out of the tier A range (0, 1]");
        AssertReports(WithStatistic(Tummy, statistic => statistic with { Epsilon = 0.2m }), "is out of the tier B range (1, 5]");
        AssertReports(WithStatistic(Tummy, statistic => statistic with { Epsilon = 6m }), "is out of the tier B range (1, 5]");
    }

    [Fact]
    public void Validate_EpsilonNullExactlyWhenNothingIsInV1()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { Epsilon = 0.2m }), $"statistic '{Naps}' epsilon must be null exactly when no output is in v1.");
        AssertReports(WithStatistic(Cry, statistic => statistic with { Epsilon = null }), $"statistic '{Cry}' epsilon must be null exactly when no output is in v1.");
    }

    [Fact]
    public void Validate_PercentileInV1_IsRejected()
    {
        AssertReports(WithStatistic(Tummy, statistic => WithTier(statistic, "p50", CommunityOutputTier.B)), $"statistic '{Tummy}' output 'p50' is a percentile and must be notInV1 (O2, section 5.1).");
        AssertReports(WithStatistic(Naps, statistic => WithTier(statistic, "p90", CommunityOutputTier.A)), $"statistic '{Naps}' output 'p90' is a percentile and must be notInV1 (O2, section 5.1).");
    }

    [Fact]
    public void Validate_OutputOutsideItsDecidedTier_IsRejected()
    {
        AssertReports(WithStatistic(Tummy, statistic => WithTier(statistic, CommunityOutputs.ShareOfDaysWithAny, CommunityOutputTier.A)), $"output '{CommunityOutputs.ShareOfDaysWithAny}' must be tier B (section 5.1).");
        AssertReports(WithStatistic(Cry, statistic => WithTier(statistic, CommunityOutputs.ShareHelpedByCause, CommunityOutputTier.B)), $"output '{CommunityOutputs.ShareHelpedByCause}' must be tier A (section 5.1).");
        AssertReports(WithStatistic(Cry, statistic => WithTier(statistic, CommunityOutputs.ShareSuggestedEqualsHelped, CommunityOutputTier.B)), $"output '{CommunityOutputs.ShareSuggestedEqualsHelped}' must be tier NotInV1 (section 5.1).");
        AssertReports(WithStatistic(Cry, statistic => WithTier(statistic, CommunityOutputs.ShareSuggestedEqualsHelped, CommunityOutputTier.B)), $"statistic '{Cry}' mixes noise tiers in v1.");
        AssertReports(WithStatistic(Tummy, statistic => WithTier(statistic, CommunityOutputs.ShareOfDaysWithAny, CommunityOutputTier.NotInV1)), $"output '{CommunityOutputs.ShareOfDaysWithAny}' must be tier B (section 5.1).");
    }

    [Fact]
    public void Validate_UndecidedShareInV1_IsRejected()
    {
        var withShare = WithStatistic(Naps, statistic => statistic with { Outputs = [.. statistic.Outputs, new(CommunityOutputs.ShareOfDaysWithAny, CommunityOutputTier.B)], Epsilon = 5m, NotInV1 = false });

        AssertReports(withShare, $"statistic '{Naps}' output '{CommunityOutputs.ShareOfDaysWithAny}' must be tier NotInV1 (section 5.1).");
        AssertReports(withShare, $"statistic '{Naps}' is in v1 but the aggregation core does not read it.");
    }

    [Fact]
    public void Validate_V1Inputs_MustBeExactlyWhatTheCoreReads()
    {
        AssertReports(WithStatistic(Cry, statistic => statistic with { Inputs = [.. statistic.Inputs, "cry_duration_bucket"] }), $"statistic '{Cry}' inputs must be exactly what the aggregation core reads: [age_weeks, local_day, what_helped_cause].");
        AssertReports(WithStatistic(Cry, statistic => statistic with { Inputs = [.. statistic.Inputs, "part_of_day"] }), $"statistic '{Cry}' inputs must be exactly what the aggregation core reads");
        AssertReports(WithStatistic(Tummy, statistic => statistic with { Inputs = ["age_weeks", "tummy_minutes_per_day"] }), $"statistic '{Tummy}' inputs must be exactly what the aggregation core reads: [age_weeks, local_day, tummy_minutes_per_day].");
    }

    [Fact]
    public void Validate_GrowthInV1_IsRejected()
    {
        var growth = WithStatistic(Growth, statistic => statistic with { Outputs = [new("p50", CommunityOutputTier.A)], NotInV1 = false, Epsilon = 0.2m });

        AssertReports(growth, $"statistic '{Growth}' must be marked notInV1 (O6).");
    }

    [Fact]
    public void Validate_NotInV1FlagAndReason_FollowTheOutputs()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { NotInV1 = false }), $"statistic '{Naps}' must be marked notInV1 (no output is in v1).");
        AssertReports(WithStatistic(Cry, statistic => statistic with { NotInV1 = true }), $"statistic '{Cry}' must not be marked notInV1 (an output is in v1).");
        AssertReports(WithStatistic(Tummy, statistic => statistic with { NotInV1Reason = null }), $"statistic '{Tummy}' needs a notInV1Reason exactly when an output is notInV1.");
        AssertReports(WithStatistic(Cry, statistic => statistic with { NotInV1Reason = null }), $"statistic '{Cry}' needs a notInV1Reason exactly when an output is notInV1.");
        AssertReports(WithStatistic(Cry, statistic => WithTier(statistic, CommunityOutputs.ShareSuggestedEqualsHelped, CommunityOutputTier.A) with { NotInV1Reason = "x" }), $"statistic '{Cry}' needs a notInV1Reason exactly when an output is notInV1.");
    }

    [Fact]
    public void Validate_EmptyRequiredFields_AreRejected()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { Description = " " }), $"statistic '{Naps}' has no description.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Inputs = [] }), $"statistic '{Naps}' has no inputs.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Outputs = [] }), $"statistic '{Naps}' has no outputs.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { CapPerBaby = 0 }), "capPerBaby 0 must be between 1 and 31.");
    }

    [Fact]
    public void Validate_StatusOtherThanPlanned_IsRejected()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { Status = "active" }), "status 'active' must be 'planned'.");
    }

    [Fact]
    public void Validate_NotProposed_IsRejected()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { Proposed = false }), "must be marked proposed");
    }

    [Fact]
    public void Validate_BandAndOutputs_MustBeKnownAndFedByInputs()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { Band = new("postcode", null) }), "band grid 'postcode' is unknown or its input is not read.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Band = new("age_weeks", "bottle_feeding_type") }), "band dimension 'bottle_feeding_type' is unknown or its inputs are not read.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Outputs = [new("mean", CommunityOutputTier.NotInV1)] }), "output 'mean' is unknown.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Outputs = [.. statistic.Outputs, statistic.Outputs[0]] }), "lists an output twice.");
    }

    [Fact]
    public void Validate_Clip_MustBeOnItsOwnInputsWithARange()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { Clip = [new("feeds_per_day", 0, 24, "count")] }), "clips 'feeds_per_day', which it does not read.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Clip = [new("naps_per_day", 12, 0, "count")] }), "clip of 'naps_per_day' needs min below max and a unit.");
    }
}
