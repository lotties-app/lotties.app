namespace BabyRoutine.Domain.Exceptions;

/// <summary>An upsert addressed an existing measurement through a baby it does not belong to.</summary>
public sealed class MeasurementBabyMismatchException : DomainException
{
    public MeasurementBabyMismatchException(Guid measurementId, Guid requestedBabyId)
        : base("measurement_baby_mismatch", $"Measurement {measurementId} does not belong to baby {requestedBabyId}; a measurement cannot change baby.")
    {
        MeasurementId = measurementId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid MeasurementId { get; }

    public Guid RequestedBabyId { get; }
}
