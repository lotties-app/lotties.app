namespace Lotties.Domain.Appointments;

/// <summary>What a baby's appointment is (docs/design/15-appointments.md). Sent and stored as lower-case codes.</summary>
public enum AppointmentType
{
    /// <summary>A doctor's consultation (<c>consultation</c>).</summary>
    Consultation,

    /// <summary>A vaccination (<c>vaccine</c>).</summary>
    Vaccine,

    /// <summary>A medical exam or test (<c>exam</c>).</summary>
    Exam,

    /// <summary>Anything else (<c>other</c>).</summary>
    Other,
}

/// <summary>
/// Where an appointment stands: <c>upcoming</c> (the default, reminders apply), <c>done</c> (only once it has started)
/// or <c>cancelled</c> (the soft delete: kept and synced, never reminded). Any status may change to any other through a
/// full-state write, within the rules of <see cref="Appointment"/>.
/// </summary>
public enum AppointmentStatus
{
    Upcoming,
    Done,
    Cancelled,
}
