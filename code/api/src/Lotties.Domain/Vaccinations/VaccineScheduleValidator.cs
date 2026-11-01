using System.Text.RegularExpressions;

namespace Lotties.Domain.Vaccinations;

/// <summary>
/// The rules a schedule file must follow before the API serves it (checked at startup and in a test): the supported
/// schema version; unique source ids, vaccine keys and dose ids (lower-case slugs); every reference resolves (vaccine
/// keys, source ids, previous doses, covered doses); <c>earliest &lt;= recommended &lt;= latest</c>; positive intervals;
/// <c>network</c> public exactly when a public source lists the dose; both languages present; <c>needsReview</c> exactly
/// when a reason is given; known conditions; a recurrence starts at the recommended age; a record-only dose covers
/// something and is no slot of its own; every alternative group has at least two scheduled members, all recurring or none.
/// </summary>
public static partial class VaccineScheduleValidator
{
    public const int KeyMaxLength = 40;
    public const int DoseIdMaxLength = 60;
    private static readonly string[] Languages = [LocalizedText.English, LocalizedText.Portuguese];
    private static readonly string[] VaccineNetworks = ["public", "private", "both"];
    private static readonly string[] SourceNetworks = ["public", "private-recommendation"];

    /// <summary>Every rule broken, as readable messages; empty when the schedule is valid.</summary>
    public static IReadOnlyList<string> Validate(VaccineSchedule schedule)
    {
        ArgumentNullException.ThrowIfNull(schedule);
        var errors = new List<string>();
        CheckHeader(schedule, errors);
        CheckSources(schedule, errors);
        CheckVaccines(schedule, errors);
        CheckDoses(schedule, errors);
        CheckGroups(schedule, errors);
        return errors;
    }

    /// <summary>Throws <see cref="InvalidOperationException"/> listing every broken rule.</summary>
    public static VaccineSchedule EnsureValid(VaccineSchedule schedule)
    {
        var errors = Validate(schedule);
        return errors.Count == 0
            ? schedule
            : throw new InvalidOperationException($"The vaccine schedule is invalid:{Environment.NewLine}- {string.Join($"{Environment.NewLine}- ", errors)}");
    }

    private static void CheckHeader(VaccineSchedule schedule, List<string> errors)
    {
        Check(schedule.SchemaVersion == VaccineSchedule.SupportedSchemaVersion, $"schemaVersion must be {VaccineSchedule.SupportedSchemaVersion}.", errors);
        Check(!string.IsNullOrWhiteSpace(schedule.Profile), "profile is required.", errors);
        Check(schedule.Doses.Any(dose => !dose.RecordOnly), "the schedule has no scheduled dose.", errors);
    }

    private static void CheckSources(VaccineSchedule schedule, List<string> errors)
    {
        CheckUnique(schedule.Sources.Select(source => source.Id), "source id", errors);
        foreach (var source in schedule.Sources)
        {
            Check(SlugPattern().IsMatch(source.Id) && source.Id.Length <= KeyMaxLength, $"source id '{source.Id}' must be a lower-case slug.", errors);
            Check(!string.IsNullOrWhiteSpace(source.Name) && !string.IsNullOrWhiteSpace(source.Edition), $"source '{source.Id}' needs a name and an edition.", errors);
            Check(Uri.TryCreate(source.Url, UriKind.Absolute, out var url) && url.Scheme == Uri.UriSchemeHttps, $"source '{source.Id}' needs an https url.", errors);
            Check(SourceNetworks.Contains(source.Network), $"source '{source.Id}' network must be one of {string.Join(", ", SourceNetworks)}.", errors);
        }
    }

    private static void CheckVaccines(VaccineSchedule schedule, List<string> errors)
    {
        CheckUnique(schedule.Vaccines.Select(vaccine => vaccine.Key), "vaccine key", errors);
        foreach (var vaccine in schedule.Vaccines)
        {
            Check(SlugPattern().IsMatch(vaccine.Key) && vaccine.Key.Length <= KeyMaxLength, $"vaccine key '{vaccine.Key}' must be a lower-case slug of at most {KeyMaxLength} characters.", errors);
            CheckLanguages(vaccine.Names, $"vaccine '{vaccine.Key}' names", errors);
            Check(Languages.All(language => vaccine.ProtectsAgainst.Values.TryGetValue(language, out var items) && items.Count > 0 && items.All(item => !string.IsNullOrWhiteSpace(item))), $"vaccine '{vaccine.Key}' protectsAgainst needs items in en and pt-BR.", errors);
            Check(VaccineNetworks.Contains(vaccine.Network), $"vaccine '{vaccine.Key}' network must be one of {string.Join(", ", VaccineNetworks)}.", errors);
        }
    }

    private static void CheckDoses(VaccineSchedule schedule, List<string> errors)
    {
        CheckUnique(schedule.Doses.Select(dose => dose.DoseId), "doseId", errors);
        var publicSources = schedule.Sources.Where(source => source.Network == "public").Select(source => source.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var dose in schedule.Doses)
        {
            CheckDose(schedule, dose, publicSources, errors);
        }
    }

    private static void CheckDose(VaccineSchedule schedule, ScheduledDose dose, IReadOnlySet<string> publicSources, List<string> errors)
    {
        var name = $"dose '{dose.DoseId}'";
        Check(SlugPattern().IsMatch(dose.DoseId) && dose.DoseId.Length <= DoseIdMaxLength, $"{name}: doseId must be a lower-case slug of at most {DoseIdMaxLength} characters.", errors);
        Check(schedule.FindVaccine(dose.VaccineKey) is not null, $"{name}: vaccineKey '{dose.VaccineKey}' is not a vaccine.", errors);
        CheckLanguages(dose.Label, $"{name} label", errors);
        CheckLanguages(dose.Notes, $"{name} notes", errors);
        CheckAges(dose, name, errors);
        CheckSourcesOf(schedule, dose, publicSources, name, errors);
        Check(dose.NeedsReview == !string.IsNullOrWhiteSpace(dose.NeedsReviewReason), $"{name}: needsReview must be true exactly when needsReviewReason is set.", errors);
        CheckReferences(schedule, dose, dose.PreviousDoseIds, "previousDoseIds", errors);
        CheckReferences(schedule, dose, dose.Covers, "covers", errors);
        Check(dose.MinIntervalDaysFromPrevious is null || dose.PreviousDoseIds.Count > 0, $"{name}: minIntervalDaysFromPrevious needs previousDoseIds.", errors);
        Check(dose.Condition is null || VaccineConditions.Known.Contains(dose.Condition), $"{name}: condition '{dose.Condition}' is not known.", errors);
        CheckRecurrence(dose, name, errors);
        Check(!dose.RecordOnly || (dose.Covers.Count > 0 && dose.AlternativeGroup is null && dose.Recurrence is null), $"{name}: a record-only dose covers other doses and has no alternative group or recurrence.", errors);
    }

    private static void CheckAges(ScheduledDose dose, string name, List<string> errors)
    {
        Check(dose.EarliestAgeDays >= 0, $"{name}: earliestAgeDays must not be negative.", errors);
        Check(dose.EarliestAgeDays <= dose.RecommendedAgeDays, $"{name}: earliestAgeDays must not be after recommendedAgeDays.", errors);
        Check(dose.LatestAgeDays is null || dose.RecommendedAgeDays <= dose.LatestAgeDays, $"{name}: recommendedAgeDays must not be after latestAgeDays.", errors);
        Check(dose.MinIntervalDaysFromPrevious is null or > 0, $"{name}: minIntervalDaysFromPrevious must be positive.", errors);
    }

    private static void CheckSourcesOf(VaccineSchedule schedule, ScheduledDose dose, IReadOnlySet<string> publicSources, string name, List<string> errors)
    {
        Check(dose.Sources.Count > 0, $"{name}: sources must not be empty.", errors);
        Check(dose.Sources.Distinct(StringComparer.Ordinal).Count() == dose.Sources.Count, $"{name}: sources must not repeat.", errors);
        foreach (var missing in dose.Sources.Where(source => schedule.Sources.All(known => known.Id != source)))
        {
            errors.Add($"{name}: source '{missing}' is not a source.");
        }

        var listedByPublic = dose.Sources.Any(publicSources.Contains);
        Check(listedByPublic == (dose.Network == VaccineNetwork.Public), $"{name}: network must be public exactly when a public source lists the dose.", errors);
    }

    private static void CheckReferences(VaccineSchedule schedule, ScheduledDose dose, IReadOnlyList<string> doseIds, string field, List<string> errors)
    {
        foreach (var doseId in doseIds)
        {
            var target = schedule.FindDose(doseId);
            Check(target is not null, $"dose '{dose.DoseId}': {field} names '{doseId}', which is not a dose.", errors);
            Check(doseId != dose.DoseId, $"dose '{dose.DoseId}': {field} must not name the dose itself.", errors);
            Check(target is null || !target.RecordOnly, $"dose '{dose.DoseId}': {field} must not name the record-only dose '{doseId}'.", errors);
        }

        Check(doseIds.Distinct(StringComparer.Ordinal).Count() == doseIds.Count, $"dose '{dose.DoseId}': {field} must not repeat.", errors);
    }

    private static void CheckRecurrence(ScheduledDose dose, string name, List<string> errors)
    {
        if (dose.Recurrence is not { } recurrence)
        {
            return;
        }

        Check(recurrence.EveryDays > 0, $"{name}: recurrence.everyDays must be positive.", errors);
        Check(recurrence.StartAgeDays == dose.RecommendedAgeDays, $"{name}: recurrence.startAgeDays must equal recommendedAgeDays.", errors);
    }

    private static void CheckGroups(VaccineSchedule schedule, List<string> errors)
    {
        foreach (var group in schedule.Doses.Where(dose => dose.AlternativeGroup is not null).GroupBy(dose => dose.AlternativeGroup!, StringComparer.Ordinal))
        {
            var members = group.ToArray();
            Check(members.Length >= 2, $"alternative group '{group.Key}' needs at least two doses.", errors);
            Check(members.All(dose => dose.Recurrence is null) || members.All(dose => dose.Recurrence is not null), $"alternative group '{group.Key}' mixes recurring and one-off doses.", errors);
        }
    }

    private static void CheckLanguages(LocalizedText text, string name, List<string> errors) =>
        Check(Languages.All(language => text.Values.TryGetValue(language, out var value) && !string.IsNullOrWhiteSpace(value)), $"{name} needs en and pt-BR.", errors);

    private static void CheckUnique(IEnumerable<string> values, string name, List<string> errors)
    {
        foreach (var duplicate in values.GroupBy(value => value, StringComparer.Ordinal).Where(group => group.Count() > 1))
        {
            errors.Add($"{name} '{duplicate.Key}' is not unique.");
        }
    }

    private static void Check(bool condition, string message, List<string> errors)
    {
        if (!condition)
        {
            errors.Add(message);
        }
    }

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*\\z", RegexOptions.CultureInvariant)]
    private static partial Regex SlugPattern();
}
