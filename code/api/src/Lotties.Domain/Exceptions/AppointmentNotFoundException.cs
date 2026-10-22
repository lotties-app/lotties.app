namespace Lotties.Domain.Exceptions;

/// <summary>No appointment with the id exists for the baby.</summary>
public sealed class AppointmentNotFoundException : DomainException
{
    public AppointmentNotFoundException(Guid babyId, Guid appointmentId)
        : base("appointment_not_found", $"Appointment {appointmentId} was not found for baby {babyId}.")
    {
        BabyId = babyId;
        AppointmentId = appointmentId;
    }

    public Guid BabyId { get; }

    public Guid AppointmentId { get; }
}
