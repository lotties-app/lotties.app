using System.Globalization;
using Lotties.Domain.Common;

namespace Lotties.Domain.Imports;

/// <summary>
/// Deterministic ids of imported records (UUID v5 in a fixed namespace), so importing the same export again finds
/// the records created the first time instead of duplicating them. Ids include the baby, so two babies importing the
/// same file never collide.
/// </summary>
public static class ImportIds
{
    /// <summary>Namespace of all Napper import ids. Never change it: existing imports would no longer be recognized.</summary>
    public static readonly Guid Namespace = new("6b1c3f0e-2f4d-4e8a-9a51-3d7b0c2e9f14");

    /// <summary>
    /// Id of the event of a Napper row: baby, category, source start and end (UTC) and the ordinal of the row among
    /// rows with the same category, start and end but different content.
    /// </summary>
    public static Guid Event(Guid babyId, string category, DateTimeOffset start, DateTimeOffset? end, int ordinal) =>
        DeterministicGuid.Create(Namespace, string.Join('|', "event", babyId.ToString("D"), category, Stamp(start), end is null ? "-" : Stamp(end.Value), ordinal.ToString(CultureInfo.InvariantCulture)));

    /// <summary>Id of a measurement: baby, date and the values rounded as stored.</summary>
    public static Guid Measurement(Guid babyId, DateOnly date, decimal? weightKg, decimal? heightCm, decimal? headCircumferenceCm) =>
        DeterministicGuid.Create(Namespace, string.Join('|', "measurement", babyId.ToString("D"), date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), Value(weightKg), Value(heightCm), Value(headCircumferenceCm)));

    /// <summary>Id of a medication created by an import: baby and the normalized name.</summary>
    public static Guid Medication(Guid babyId, string normalizedName) =>
        DeterministicGuid.Create(Namespace, string.Join('|', "medication", babyId.ToString("D"), normalizedName));

    private static string Stamp(DateTimeOffset value) =>
        UtcTime.Normalize(value).ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'", CultureInfo.InvariantCulture);

    private static string Value(decimal? value) =>
        value is null ? "-" : Math.Round(value.Value, Measurements.Measurement.DecimalPlaces, MidpointRounding.AwayFromZero).ToString("0.00", CultureInfo.InvariantCulture);
}
