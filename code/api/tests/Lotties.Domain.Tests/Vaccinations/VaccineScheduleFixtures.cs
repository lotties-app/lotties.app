using Lotties.Domain.Vaccinations;

namespace Lotties.Domain.Tests.Vaccinations;

/// <summary>Small schedules for tests: doses with only the fields that matter (the defaults of the shared vectors file).</summary>
internal static class VaccineScheduleFixtures
{
    public static ScheduledDose Dose(
        string doseId,
        int recommendedAgeDays,
        string vaccineKey = "v",
        int? latestAgeDays = null,
        VaccineNetwork network = VaccineNetwork.Public,
        string? alternativeGroup = null,
        string[]? covers = null,
        DoseRecurrence? recurrence = null,
        bool recordOnly = false) =>
        new(
            vaccineKey,
            doseId,
            Text(doseId),
            recommendedAgeDays,
            recommendedAgeDays,
            latestAgeDays,
            null,
            [network == VaccineNetwork.Private ? "sbp" : "pni"],
            network,
            Text(doseId),
            alternativeGroup,
            false,
            null,
            [],
            covers ?? [],
            recurrence,
            null,
            recordOnly);

    /// <summary>A schedule with the three sources and one vaccine per vaccine key used, named "{key} (detail)" in both languages.</summary>
    public static VaccineSchedule Schedule(params ScheduledDose[] doses) =>
        new(
            VaccineSchedule.SupportedSchemaVersion,
            "TEST",
            new DateOnly(2026, 10, 22),
            [
                new VaccineSource("pni", "PNI", "2026", "https://example.org/pni", new DateOnly(2026, 10, 22), "public"),
                new VaccineSource("sbp", "SBP", "2026", "https://example.org/sbp", new DateOnly(2026, 10, 22), "private-recommendation"),
            ],
            doses.Select(dose => dose.VaccineKey).Distinct().Select(key => new VaccineDefinition(
                key,
                new LocalizedText(new Dictionary<string, string> { ["en"] = $"{key} (detail)", ["pt-BR"] = $"{key} pt (detalhe)" }),
                new LocalizedList(new Dictionary<string, IReadOnlyList<string>> { ["en"] = [key], ["pt-BR"] = [key] }),
                "both")).ToArray(),
            doses);

    private static LocalizedText Text(string text) => new(new Dictionary<string, string> { ["en"] = text, ["pt-BR"] = text });
}
