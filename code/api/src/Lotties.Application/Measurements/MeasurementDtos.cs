using Lotties.Application.Professionals;
using Lotties.Domain.Measurements;

namespace Lotties.Application.Measurements;

/// <summary>A growth measurement of a baby.</summary>
public sealed record MeasurementResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public DateOnly Date { get; init; }

    public decimal? WeightKg { get; init; }

    public decimal? HeightCm { get; init; }

    public decimal? HeadCircumferenceCm { get; init; }

    public string? Notes { get; init; }

    public Guid CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset UpdatedAt { get; init; }

    /// <summary>Whether a Doctor recorded it during a consultation (additive).</summary>
    public bool RecordedByDoctor { get; init; }

    /// <summary>The Doctor who recorded it, as the family sees her; only when <see cref="RecordedByDoctor"/> (additive).</summary>
    public PersonSummary? RecordedBy { get; init; }

    /// <summary>The measurement with the Doctor who recorded it (<paramref name="recordedBy"/>, used only when it was a Doctor).</summary>
    public static MeasurementResponse For(Measurement measurement, PersonSummary? recordedBy)
    {
        MeasurementResponse response = measurement;
        return response with { RecordedBy = measurement.RecordedByDoctor ? recordedBy : null };
    }

    public static implicit operator MeasurementResponse(Measurement measurement)
    {
        ArgumentNullException.ThrowIfNull(measurement);
        return new MeasurementResponse
        {
            RecordedByDoctor = measurement.RecordedByDoctor,
            Id = measurement.Id,
            BabyId = measurement.BabyId,
            Date = measurement.Date,
            WeightKg = measurement.WeightKg,
            HeightCm = measurement.HeightCm,
            HeadCircumferenceCm = measurement.HeadCircumferenceCm,
            Notes = measurement.Notes,
            CreatedBy = measurement.CreatedBy,
            CreatedAt = measurement.CreatedAt,
            UpdatedAt = measurement.UpdatedAt,
        };
    }
}

/// <summary>Body of <c>PUT /api/v1/babies/{babyId}/measurements/{measurementId}</c>: the full editable state.</summary>
public sealed record UpsertMeasurementRequest
{
    public required DateOnly Date { get; init; }

    public decimal? WeightKg { get; init; }

    public decimal? HeightCm { get; init; }

    public decimal? HeadCircumferenceCm { get; init; }

    public string? Notes { get; init; }
}

/// <summary>The outcome of an upsert: the measurement as stored, and whether this request created it.</summary>
public sealed record UpsertMeasurementResult(MeasurementResponse Measurement, bool Created);
