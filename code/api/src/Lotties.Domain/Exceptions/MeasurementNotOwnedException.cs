namespace Lotties.Domain.Exceptions;

/// <summary>A Doctor tried to edit or delete a measurement someone else recorded; she changes only her own.</summary>
public sealed class MeasurementNotOwnedException : DomainException
{
    public MeasurementNotOwnedException(Guid measurementId, Guid userId)
        : base("measurement_not_owned", $"Measurement {measurementId} was recorded by another member; this role changes only its own measurements.")
    {
        MeasurementId = measurementId;
        UserId = userId;
    }

    public Guid MeasurementId { get; }

    public Guid UserId { get; }
}
