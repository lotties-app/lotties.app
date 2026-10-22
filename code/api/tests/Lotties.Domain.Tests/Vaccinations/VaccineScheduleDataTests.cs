using Lotties.Domain.Vaccinations;

namespace Lotties.Domain.Tests.Vaccinations;

/// <summary>
/// The shipped schedule (code/api/data/vaccine-schedule.br.json, linked into the test output) follows every rule of
/// <see cref="VaccineScheduleValidator"/> and keeps the research decisions of docs/design/17 (schema v2 section).
/// </summary>
public sealed class VaccineScheduleDataTests
{
    private static readonly Lazy<string> Json = new(() => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Vaccinations", "vaccine-schedule.br.json")));

    private static VaccineSchedule Schedule => VaccineScheduleJson.Parse(Json.Value);

    [Fact]
    public void ShippedSchedule_FollowsEveryRule()
    {
        Assert.Empty(VaccineScheduleValidator.Validate(Schedule));
    }

    [Fact]
    public void ShippedSchedule_KeepsTheResearchCountsAndFlags()
    {
        var schedule = Schedule;

        Assert.Equal(2, schedule.SchemaVersion);
        Assert.Equal(["pni", "sbp", "sbim"], schedule.Sources.Select(source => source.Id));
        Assert.Equal(66, schedule.Doses.Count(dose => !dose.RecordOnly));
        Assert.Equal(23, schedule.Doses.Count(dose => dose.NeedsReview));
        Assert.All(schedule.Doses.Where(dose => dose.NeedsReview), dose => Assert.False(string.IsNullOrWhiteSpace(dose.NeedsReviewReason)));
    }

    [Fact]
    public void ShippedSchedule_ExpressesTheSchemaV2Rules()
    {
        var schedule = Schedule;

        Assert.Equal(["vip-1", "hepatite-b-2"], schedule.FindDose("hexavalente-1")!.Covers);
        Assert.Equal(["hepatite-b-2"], schedule.FindDose("penta-1")!.Covers);
        Assert.Equal(new DoseRecurrence(365, 365), schedule.FindDose("influenza-anual")!.Recurrence);
        Assert.Equal(new DoseRecurrence(365, 365), schedule.FindDose("influenza-anual-sociedades")!.Recurrence);
        Assert.Equal(VaccineConditions.RsvMaternalVaccinationUnknownOrNo, schedule.FindDose("vsr-nirsevimabe-1")!.Condition);
        Assert.All(schedule.Doses.Where(dose => dose.VaccineKey == "tetraviral"), dose => Assert.True(dose.RecordOnly));
        Assert.Equal(["triplice-viral-2", "varicela-1"], schedule.FindDose("tetraviral-15m")!.Covers);
    }

    [Fact]
    public void ShippedSchedule_GivesEveryPublicBirthDoseAtBirth()
    {
        var birth = new DateOnly(2026, 10, 1);

        var result = VaccineStatusCalculator.Calculate(new VaccineStatusInput(Schedule, VaccineProfile.Default, birth, [], birth));

        Assert.Equal(["bcg-1", "hepatite-b-1"], result.Doses.Where(dose => dose.State == DoseState.Due).Select(dose => dose.DoseId));
        Assert.Equal(DoseState.NotApplicable, result.Doses.Single(dose => dose.DoseId == "vsr-nirsevimabe-1").State);
    }

    [Fact]
    public void ShippedSchedule_PentaCoversTheStandaloneHepatitisBDose()
    {
        var birth = new DateOnly(2026, 1, 1);
        var profile = VaccineProfile.Create(VaccineCoverage.PublicAndPrivate, null, null);
        VaccinationRecord[] records = [new(Guid.NewGuid(), "penta-1", birth.AddDays(61))];

        var result = VaccineStatusCalculator.Calculate(new VaccineStatusInput(Schedule, profile, birth, records, birth.AddDays(70)));

        var hepatitisB2 = result.Doses.Single(dose => dose.DoseId == "hepatite-b-2");
        Assert.Equal((DoseState.Given, "penta-1"), (hepatitisB2.State, hepatitisB2.CoveredBy));
        Assert.Equal(NotApplicableReason.Alternative, result.Doses.Single(dose => dose.DoseId == "hexavalente-1").Reason);
    }

    [Fact]
    public void Parse_MissingProperty_NamesThePath()
    {
        var broken = Json.Value.Replace("\"recordOnly\": false", "\"recordOnlyX\": false", StringComparison.Ordinal);

        var error = Assert.Throws<FormatException>(() => VaccineScheduleJson.Parse(broken));

        Assert.Contains("$.doses[0].recordOnly is missing", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void Validate_BrokenRules_ListsEachOne()
    {
        var broken = Json.Value
            .ReplaceLineEndings("\n")
            .Replace("\"doseId\": \"bcg-1\"", "\"doseId\": \"hepatite-b-1\"", StringComparison.Ordinal)
            .Replace("\"recommendedAgeDays\": 61,\n      \"earliestAgeDays\": 42", "\"recommendedAgeDays\": 30,\n      \"earliestAgeDays\": 42", StringComparison.Ordinal);

        var errors = VaccineScheduleValidator.Validate(VaccineScheduleJson.Parse(broken));

        Assert.Contains("doseId 'hepatite-b-1' is not unique.", errors);
        Assert.Contains("dose 'penta-1': earliestAgeDays must not be after recommendedAgeDays.", errors);
    }
}
