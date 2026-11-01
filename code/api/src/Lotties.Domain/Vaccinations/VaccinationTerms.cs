using System.Text.RegularExpressions;
using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Vaccinations;

/// <summary>
/// The full editable state of a recorded vaccine: the schedule's vaccine key and dose id (both optional; a dose id only
/// with a vaccine key), or a custom name (required, 1-80 characters, when there is no vaccine key, and only then); the
/// dose label as shown when it was recorded (a snapshot, 80; history survives schedule updates); the day it was given
/// (from 2000-01-01; "not in the future" needs the clock and lives in <see cref="Vaccination"/>); where (public or
/// private network); and the optional clinic (120), lot (40), who gave it (80) and notes (1000). Text is trimmed, blank
/// optional text is absent, NUL is rejected. Compared by value, so an idempotent replay changes nothing.
/// </summary>
public sealed partial record VaccinationTerms
{
    public const int VaccineKeyMaxLength = 40;
    public const int DoseIdMaxLength = 60;
    public const int CustomNameMaxLength = 80;
    public const int DoseLabelMaxLength = 80;
    public const int ClinicMaxLength = 120;
    public const int LotMaxLength = 40;
    public const int AdministeredByMaxLength = 80;
    public const int NotesMaxLength = 1000;

    public static readonly DateOnly EarliestGivenOn = new(2000, 1, 1);

    private VaccinationTerms(
        string? vaccineKey,
        string? doseId,
        string? customName,
        string? doseLabel,
        DateOnly givenOn,
        VaccineNetwork network,
        string? clinic,
        string? lot,
        string? administeredBy,
        string? notes)
    {
        VaccineKey = vaccineKey;
        DoseId = doseId;
        CustomName = customName;
        DoseLabel = doseLabel;
        GivenOn = givenOn;
        Network = network;
        Clinic = clinic;
        Lot = lot;
        AdministeredBy = administeredBy;
        Notes = notes;
    }

    /// <summary>The schedule's vaccine key; <c>null</c> for a vaccine outside the schedule (<see cref="CustomName"/>).</summary>
    public string? VaccineKey { get; }

    /// <summary>The scheduled dose the record satisfies; <c>null</c> when none was chosen.</summary>
    public string? DoseId { get; }

    public string? CustomName { get; }

    public string? DoseLabel { get; }

    public DateOnly GivenOn { get; }

    public VaccineNetwork Network { get; }

    public string? Clinic { get; }

    public string? Lot { get; }

    public string? AdministeredBy { get; }

    public string? Notes { get; }

    /// <summary>Validates every rule but the clock one; throws <see cref="DomainValidationException"/> naming the field.</summary>
    public static VaccinationTerms Create(
        string? vaccineKey,
        string? doseId,
        string? customName,
        string? doseLabel,
        DateOnly givenOn,
        VaccineNetwork network,
        string? clinic,
        string? lot,
        string? administeredBy,
        string? notes)
    {
        var key = Slug(vaccineKey, "vaccineKey", VaccineKeyMaxLength);
        var dose = Slug(doseId, "doseId", DoseIdMaxLength);
        if (dose is not null && key is null)
        {
            throw new DomainValidationException("doseId", "doseId needs a vaccineKey.");
        }

        return new VaccinationTerms(
            key,
            dose,
            CustomNameFor(key, customName),
            Text.Optional(doseLabel, "doseLabel", DoseLabelMaxLength),
            givenOn >= EarliestGivenOn ? givenOn : throw new DomainValidationException("givenOn", "givenOn must not be before 2000-01-01."),
            Enum.IsDefined(network) ? network : throw new DomainValidationException("network", "network must be public or private."),
            Text.Optional(clinic, "clinic", ClinicMaxLength),
            Text.Optional(lot, "lot", LotMaxLength),
            Text.Optional(administeredBy, "administeredBy", AdministeredByMaxLength),
            Text.Optional(notes, "notes", NotesMaxLength));
    }

    /// <summary>Required for a vaccine outside the schedule, refused for a scheduled one (its name comes from the schedule).</summary>
    private static string? CustomNameFor(string? vaccineKey, string? customName)
    {
        if (vaccineKey is null)
        {
            return Text.Required(customName, "customName", CustomNameMaxLength);
        }

        return string.IsNullOrWhiteSpace(customName)
            ? null
            : throw new DomainValidationException("customName", "customName is only for a vaccine outside the schedule (no vaccineKey).");
    }

    private static string? Slug(string? value, string field, int maxLength)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length <= maxLength && SlugPattern().IsMatch(trimmed)
            ? trimmed
            : throw new DomainValidationException(field, $"{field} must be a lower-case slug of at most {maxLength} characters.");
    }

    [GeneratedRegex("^[a-z0-9]+(?:-[a-z0-9]+)*\\z", RegexOptions.CultureInvariant)]
    private static partial Regex SlugPattern();
}
