using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Measurements;

/// <summary>
/// A growth measurement of a baby on a day: at least one of weight, height and head circumference. Several per day
/// are allowed. Values are rounded to two decimals.
/// </summary>
public sealed class Measurement
{
    public const int NotesMaxLength = 1000;
    public const decimal WeightMinKg = 0.3m;
    public const decimal WeightMaxKg = 40m;
    public const decimal HeightMinCm = 20m;
    public const decimal HeightMaxCm = 130m;
    public const decimal HeadCircumferenceMinCm = 20m;
    public const decimal HeadCircumferenceMaxCm = 60m;
    public const int DecimalPlaces = 2;

    /// <summary>The earliest accepted measurement date.</summary>
    public static readonly DateOnly EarliestDate = new(2000, 1, 1);

    private Measurement()
    {
    }

    private Measurement(Guid id, Guid babyId, Guid createdBy, DateTimeOffset createdAt)
    {
        Id = id;
        BabyId = babyId;
        CreatedBy = createdBy;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    public DateOnly Date { get; private set; }

    public decimal? WeightKg { get; private set; }

    public decimal? HeightCm { get; private set; }

    public decimal? HeadCircumferenceCm { get; private set; }

    public string? Notes { get; private set; }

    public Guid CreatedBy { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    /// <summary>Creates a measurement with a client-generated id, for idempotent upserts. <paramref name="now"/> bounds the date.</summary>
    public static Measurement Create(
        Guid id,
        Guid babyId,
        DateOnly date,
        decimal? weightKg,
        decimal? heightCm,
        decimal? headCircumferenceCm,
        string? notes,
        Guid createdBy,
        DateTimeOffset now)
    {
        var measurement = new Measurement(Ids.Required(id, nameof(id)), Ids.Required(babyId, nameof(babyId)), Ids.Required(createdBy, nameof(createdBy)), UtcTime.Normalize(now));
        measurement.Apply(date, weightKg, heightCm, headCircumferenceCm, notes, measurement.CreatedAt);
        return measurement;
    }

    /// <summary>
    /// Applies the full editable state. Nothing changes, not even <see cref="UpdatedAt"/>, when the validated state
    /// equals the stored one, so a replayed request returns the same representation.
    /// </summary>
    public void Edit(DateOnly date, decimal? weightKg, decimal? heightCm, decimal? headCircumferenceCm, string? notes, DateTimeOffset now)
    {
        var storedState = (Date, WeightKg, HeightCm, HeadCircumferenceCm, Notes);
        var storedUpdatedAt = UpdatedAt;
        Apply(date, weightKg, heightCm, headCircumferenceCm, notes, UtcTime.Normalize(now));
        if (storedState == (Date, WeightKg, HeightCm, HeadCircumferenceCm, Notes))
        {
            UpdatedAt = storedUpdatedAt;
        }
    }

    private void Apply(DateOnly date, decimal? weightKg, decimal? heightCm, decimal? headCircumferenceCm, string? notes, DateTimeOffset now)
    {
        var validatedWeight = Value(weightKg, nameof(WeightKg), WeightMinKg, WeightMaxKg);
        var validatedHeight = Value(heightCm, nameof(HeightCm), HeightMinCm, HeightMaxCm);
        var validatedHead = Value(headCircumferenceCm, nameof(HeadCircumferenceCm), HeadCircumferenceMinCm, HeadCircumferenceMaxCm);
        EnsureAnyValue(validatedWeight, validatedHeight, validatedHead);
        var validatedDate = ValidDate(date, now);
        var validatedNotes = Text.Optional(notes, nameof(Notes), NotesMaxLength);
        Date = validatedDate;
        WeightKg = validatedWeight;
        HeightCm = validatedHeight;
        HeadCircumferenceCm = validatedHead;
        Notes = validatedNotes;
        UpdatedAt = now;
    }

    private static decimal? Value(decimal? value, string field, decimal min, decimal max)
    {
        if (value is null)
        {
            return null;
        }

        var rounded = Math.Round(value.Value, DecimalPlaces, MidpointRounding.AwayFromZero);
        return rounded >= min && rounded <= max
            ? rounded
            : throw new DomainValidationException(field, $"{field} must be between {min} and {max}.");
    }

    private static void EnsureAnyValue(decimal? weightKg, decimal? heightCm, decimal? headCircumferenceCm)
    {
        if (weightKg is null && heightCm is null && headCircumferenceCm is null)
        {
            throw new MeasurementWithoutValuesException();
        }
    }

    private static DateOnly ValidDate(DateOnly date, DateTimeOffset now)
    {
        var latest = DateOnly.FromDateTime(now.UtcDateTime).AddDays(1);
        return date >= EarliestDate && date <= latest
            ? date
            : throw new DomainValidationException(nameof(Date), $"{nameof(Date)} must be between {EarliestDate:yyyy-MM-dd} and {latest:yyyy-MM-dd}.");
    }
}
