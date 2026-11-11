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

    private static CommunityStatisticsCatalog Valid => ShippedCommunityStatistics.Catalog;

    private static CommunityStatisticsCatalog WithStatistic(string key, Func<CommunityStatistic, CommunityStatistic> change) =>
        Valid with { Statistics = Valid.Statistics.Select(statistic => statistic.Key == key ? change(statistic) : statistic).ToArray() };

    private static CommunityStatisticsCatalog WithGrids(Func<CommunityBandGrids, CommunityBandGrids> change) =>
        Valid with { BandGrids = change(Valid.BandGrids) };

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
        AssertReports(Valid with { Schema = 2 }, "schema must be 1.");
        AssertReports(Valid with { Version = 0 }, "version must be 1 or more.");
        AssertReports(Valid with { GeneratedFor = "collected" }, "generatedFor must be 'catalog only, not collected'.");
        AssertReports(Valid with { Release = "nightly" }, "release 'nightly' must be one of");
    }

    [Fact]
    public void Validate_Grids_ChecksContiguityStepsEdgesAndCryBands()
    {
        AssertReports(WithGrids(grids => grids with { AgeWeeksFine = [new(0, 12, 1), new(14, 104, 2)] }), "ageWeeksFine segments must be contiguous.");
        AssertReports(WithGrids(grids => grids with { AgeWeeksFine = [new(1, 104, 1)] }), "ageWeeksFine must start at week 0.");
        AssertReports(WithGrids(grids => grids with { AgeWeeksCoarse = [new(0, 52, 4)] }), "ageWeeksCoarse must end at week 104.");
        AssertReports(WithGrids(grids => grids with { AgeWeeksCoarse = [new(0, 104, 5)] }), "ageWeeksCoarse segments must have a positive step that divides them.");
        AssertReports(WithGrids(grids => grids with { AgeWeeksCoarse = [new(0, 2, 2), new(2, 104, 6)] }), "every ageWeeksCoarse edge must be an ageWeeksFine edge.");
        AssertReports(WithGrids(grids => grids with { CryAgeBands = ["newborn"] }), "cryAgeBands must be [");
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
        AssertReports(WithStatistic(Naps, statistic => statistic with { K = 19, KHysteresis = 18 }), "k 19 is below 20.");
    }

    [Fact]
    public void Validate_HysteresisAboveK_IsRejected()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { KHysteresis = 21 }), "kHysteresis 21 must be between 1 and k.");
    }

    [Fact]
    public void Validate_TailsWithoutKTails50_AreRejected()
    {
        AssertReports(WithStatistic(Growth, statistic => statistic with { KTails = 30 }), "needs kTails of at least 50 exactly when it publishes p3/p97.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Outputs = [.. statistic.Outputs, "p97"] }), "needs kTails of at least 50");
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
    public void Validate_EpsilonOutOfRange_IsRejected()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { Epsilon = 0m }), "epsilon 0 is out of range");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Epsilon = 1.5m }), $"epsilon {1.5m} is out of range");
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
    public void Validate_GrowthInV1_IsRejected()
    {
        AssertReports(WithStatistic(Growth, statistic => statistic with { NotInV1 = false, NotInV1Reason = null }), $"statistic '{Growth}' must be marked notInV1 (O6).");
        AssertReports(WithStatistic(Naps, statistic => statistic with { NotInV1 = true, NotInV1Reason = "x" }), $"statistic '{Naps}' must not be marked notInV1.");
        AssertReports(WithStatistic(Growth, statistic => statistic with { NotInV1Reason = null }), "needs a notInV1Reason exactly when notInV1 is true.");
    }

    [Fact]
    public void Validate_BandAndOutputs_MustBeKnownAndFedByInputs()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { Band = new("postcode", null) }), "band grid 'postcode' is unknown or its input is not read.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Band = new("age_weeks", "bottle_feeding_type") }), "band dimension 'bottle_feeding_type' is unknown or its inputs are not read.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Outputs = ["mean"] }), "output 'mean' is unknown.");
    }

    [Fact]
    public void Validate_Clip_MustBeOnItsOwnInputsWithARange()
    {
        AssertReports(WithStatistic(Naps, statistic => statistic with { Clip = [new("feeds_per_day", 0, 24, "count")] }), "clips 'feeds_per_day', which it does not read.");
        AssertReports(WithStatistic(Naps, statistic => statistic with { Clip = [new("naps_per_day", 12, 0, "count")] }), "clip of 'naps_per_day' needs min below max and a unit.");
    }
}
