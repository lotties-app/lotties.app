namespace Lotties.Domain.Vaccinations;

/// <summary>
/// A vaccine schedule as published in <c>code/api/data/vaccine-schedule.br.json</c> (schema v2, docs/design/17 and 18):
/// the sources, the vaccines and their scheduled doses. Facts only, never advice: the status engine
/// (<see cref="VaccineStatusCalculator"/>) reads it to say which doses are due according to this schedule.
/// </summary>
public sealed class VaccineSchedule
{
    /// <summary>The schema version this code reads.</summary>
    public const int SupportedSchemaVersion = 2;

    private readonly IReadOnlyDictionary<string, ScheduledDose> _dosesById;
    private readonly IReadOnlyDictionary<string, VaccineDefinition> _vaccinesByKey;

    public VaccineSchedule(
        int schemaVersion,
        string profile,
        DateOnly generatedOn,
        IReadOnlyList<VaccineSource> sources,
        IReadOnlyList<VaccineDefinition> vaccines,
        IReadOnlyList<ScheduledDose> doses)
    {
        SchemaVersion = schemaVersion;
        Profile = profile ?? throw new ArgumentNullException(nameof(profile));
        GeneratedOn = generatedOn;
        Sources = sources ?? throw new ArgumentNullException(nameof(sources));
        Vaccines = vaccines ?? throw new ArgumentNullException(nameof(vaccines));
        Doses = doses ?? throw new ArgumentNullException(nameof(doses));
        _dosesById = doses.GroupBy(dose => dose.DoseId, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        _vaccinesByKey = vaccines.GroupBy(vaccine => vaccine.Key, StringComparer.Ordinal).ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
    }

    public int SchemaVersion { get; }

    public string Profile { get; }

    public DateOnly GeneratedOn { get; }

    public IReadOnlyList<VaccineSource> Sources { get; }

    public IReadOnlyList<VaccineDefinition> Vaccines { get; }

    /// <summary>Every dose in file order, record-only products included.</summary>
    public IReadOnlyList<ScheduledDose> Doses { get; }

    /// <summary>The dose with <paramref name="doseId"/>, or <c>null</c> (an id of an older schedule, or unknown).</summary>
    public ScheduledDose? FindDose(string? doseId) =>
        doseId is not null && _dosesById.TryGetValue(doseId, out var dose) ? dose : null;

    /// <summary>The vaccine with <paramref name="key"/>, or <c>null</c>.</summary>
    public VaccineDefinition? FindVaccine(string? key) =>
        key is not null && _vaccinesByKey.TryGetValue(key, out var vaccine) ? vaccine : null;
}

/// <summary>Where the facts come from (with the network: <c>public</c> for the PNI, <c>private-recommendation</c> for the societies).</summary>
public sealed record VaccineSource(string Id, string Name, string Edition, string Url, DateOnly RetrievedOn, string Network);

/// <summary>A vaccine (or a combined product) with its names and what it protects against, per language.</summary>
public sealed record VaccineDefinition(string Key, LocalizedText Names, LocalizedList ProtectsAgainst, string Network);

/// <summary>
/// One dose of a vaccine in the schedule. Ages are in whole days from the birth date. <see cref="AlternativeGroup"/>
/// doses fill the same slot (recording one satisfies the slot); <see cref="Covers"/> lists the other doses a combined
/// product also satisfies; <see cref="PreviousDoseIds"/> are the doses <see cref="MinIntervalDaysFromPrevious"/> counts
/// from (the latest given one); <see cref="Recurrence"/> repeats the dose (yearly influenza); <see cref="Condition"/>
/// limits it to some babies (<see cref="VaccineConditions"/>); a <see cref="RecordOnly"/> dose is a combined product the
/// family can record but that is never a slot of its own.
/// </summary>
public sealed record ScheduledDose(
    string VaccineKey,
    string DoseId,
    LocalizedText Label,
    int RecommendedAgeDays,
    int EarliestAgeDays,
    int? LatestAgeDays,
    int? MinIntervalDaysFromPrevious,
    IReadOnlyList<string> Sources,
    VaccineNetwork Network,
    LocalizedText Notes,
    string? AlternativeGroup,
    bool NeedsReview,
    string? NeedsReviewReason,
    IReadOnlyList<string> PreviousDoseIds,
    IReadOnlyList<string> Covers,
    DoseRecurrence? Recurrence,
    string? Condition,
    bool RecordOnly)
{
    /// <summary>The slot the dose fills: its alternative group, or the dose itself.</summary>
    public string Slot => AlternativeGroup ?? DoseId;
}

/// <summary>A repeating dose: due from <see cref="StartAgeDays"/>, then again <see cref="EveryDays"/> after the latest one given.</summary>
public sealed record DoseRecurrence(int EveryDays, int StartAgeDays);

/// <summary>Where a dose is offered: in the public network (SUS, PNI) or recommended for private clinics only.</summary>
public enum VaccineNetwork
{
    Public,
    Private,
}

/// <summary>The known values of <see cref="ScheduledDose.Condition"/>.</summary>
public static class VaccineConditions
{
    /// <summary>Applies unless the mother got the RSV vaccine in pregnancy (unknown or no).</summary>
    public const string RsvMaternalVaccinationUnknownOrNo = "rsv-maternal-vaccination-unknown-or-no";

    public static IReadOnlySet<string> Known { get; } = new HashSet<string>(StringComparer.Ordinal) { RsvMaternalVaccinationUnknownOrNo };

    /// <summary>Whether a dose with <paramref name="condition"/> applies to a baby with <paramref name="profile"/>.</summary>
    public static bool IsMet(string? condition, VaccineProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);
        return condition switch
        {
            null => true,
            RsvMaternalVaccinationUnknownOrNo => profile.RsvMaternalVaccination != RsvMaternalVaccination.Yes,
            _ => true,
        };
    }
}

/// <summary>Text per language code (<c>en</c>, <c>pt-BR</c>).</summary>
public sealed record LocalizedText(IReadOnlyDictionary<string, string> Values)
{
    public const string English = "en";
    public const string Portuguese = "pt-BR";

    /// <summary>The text in <paramref name="language"/>, else English, else any.</summary>
    public string In(string? language) =>
        (language is not null && Values.TryGetValue(language, out var text) ? text : null)
        ?? (Values.TryGetValue(English, out var english) ? english : Values.Values.FirstOrDefault() ?? string.Empty);
}

/// <summary>A list of texts per language code.</summary>
public sealed record LocalizedList(IReadOnlyDictionary<string, IReadOnlyList<string>> Values);
