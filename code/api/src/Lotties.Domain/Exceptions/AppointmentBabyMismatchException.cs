namespace Lotties.Domain.Exceptions;

/// <summary>An upsert addressed an existing appointment through a baby it does not belong to.</summary>
public sealed class AppointmentBabyMismatchException : DomainException
{
    public AppointmentBabyMismatchException(Guid appointmentId, Guid requestedBabyId)
        : base("appointment_baby_mismatch", $"Appointment {appointmentId} does not belong to baby {requestedBabyId}; an appointment cannot change baby.")
    {
        AppointmentId = appointmentId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid AppointmentId { get; }

    public Guid RequestedBabyId { get; }
}
