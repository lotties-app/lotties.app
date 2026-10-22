using Lotties.Domain.Common;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Appointments;

/// <summary>
/// A doctor appointment of one baby (docs/design/15-appointments.md). The id is client generated; sync follows the
/// formulas contract: <see cref="UpdatedAt"/> (server receive time) is the delta cursor, <see cref="ClientUpdatedAt"/>
/// (client edit time, bounded to the server clock + 5 min) decides conflicts. Never deleted: a cancelled appointment
/// (<see cref="AppointmentStatus.Cancelled"/>) is the soft delete. <see cref="AppointmentStatus.Done"/> is allowed only
/// once the start is not in the future (<see cref="StartSkewAllowance"/> covers a client clock running ahead).
/// Reminders go only for upcoming appointments; their keys name the start, so moving it plans new ones.
/// </summary>
public sealed class Appointment
{
    /// <summary>A visit is "started" up to this long before its start on the server clock (the client edit-time bound).</summary>
    public static readonly TimeSpan StartSkewAllowance = ClientEditTime.MaxFutureSkew;

    private Appointment()
    {
    }

    private Appointment(Guid id, Guid babyId, Guid createdBy, DateTimeOffset createdAt, DateTimeOffset clientUpdatedAt)
    {
        Id = id;
        BabyId = babyId;
        CreatedBy = createdBy;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
        ClientUpdatedAt = clientUpdatedAt;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    public string Title { get; private set; } = string.Empty;

    public AppointmentType Type { get; private set; }

    public DateTimeOffset StartsAt { get; private set; }

    public int? DurationMinutes { get; private set; }

    public string? Location { get; private set; }

    public string? DoctorName { get; private set; }

    public string? Notes { get; private set; }

    public string? Outcome { get; private set; }

    public AppointmentStatus Status { get; private set; }

    public AppointmentReminders Reminders { get; private set; } = AppointmentReminders.Default;

    public Guid CreatedBy { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset ClientUpdatedAt { get; private set; }

    public AppointmentTerms Terms =>
        AppointmentTerms.Create(Title, Type, StartsAt, DurationMinutes, Location, DoctorName, Notes, Outcome, Status, Reminders);

    /// <summary>Whether reminders may still go: upcoming and not started at <paramref name="now"/>.</summary>
    public bool IsRemindableAt(DateTimeOffset now) => Status == AppointmentStatus.Upcoming && StartsAt > now;

    public static Appointment Create(Guid id, Guid babyId, AppointmentTerms terms, Guid createdBy, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        EnsureStatusAllowed(id, terms, now);
        var appointment = new Appointment(
            Ids.Required(id, nameof(id)),
            Ids.Required(babyId, nameof(babyId)),
            Ids.Required(createdBy, nameof(createdBy)),
            UtcTime.Normalize(now),
            ClientEditTime.Bound(clientUpdatedAt, now));
        appointment.Apply(terms);
        return appointment;
    }

    /// <summary>
    /// Decides how a client upsert applies, before any change: an appointment never moves to another baby
    /// (<see cref="AppointmentBabyMismatchException"/>), and a write whose bounded client time is strictly older than
    /// <see cref="ClientUpdatedAt"/> loses (last write wins). Ties and absent times apply.
    /// </summary>
    public AppointmentUpsertDecision DecideUpsert(Guid babyId, DateTimeOffset? clientUpdatedAt, DateTimeOffset now)
    {
        if (BabyId != babyId)
        {
            throw new AppointmentBabyMismatchException(Id, babyId);
        }

        return clientUpdatedAt is not null && ClientEditTime.Bound(clientUpdatedAt, now) < ClientUpdatedAt
            ? AppointmentUpsertDecision.IgnoreStale
            : AppointmentUpsertDecision.Apply;
    }

    /// <summary>
    /// Applies the full terms. Equal terms change nothing (not even the timestamps), so a replay returns the same
    /// representation; otherwise <see cref="UpdatedAt"/> becomes <paramref name="now"/> and <see cref="ClientUpdatedAt"/>
    /// the bounded client time. <c>done</c> with a start still in the future is refused
    /// (<see cref="AppointmentNotStartedException"/>).
    /// </summary>
    public void Edit(AppointmentTerms terms, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (terms == Terms)
        {
            return;
        }

        EnsureStatusAllowed(Id, terms, now);
        Apply(terms);
        UpdatedAt = UtcTime.Normalize(now);
        ClientUpdatedAt = ClientEditTime.Bound(clientUpdatedAt, now);
    }

    private static void EnsureStatusAllowed(Guid id, AppointmentTerms terms, DateTimeOffset now)
    {
        if (terms.Status == AppointmentStatus.Done && terms.StartsAt > now + StartSkewAllowance)
        {
            throw new AppointmentNotStartedException(id, terms.StartsAt);
        }
    }

    private void Apply(AppointmentTerms terms)
    {
        Title = terms.Title;
        Type = terms.Type;
        StartsAt = terms.StartsAt;
        DurationMinutes = terms.DurationMinutes;
        Location = terms.Location;
        DoctorName = terms.DoctorName;
        Notes = terms.Notes;
        Outcome = terms.Outcome;
        Status = terms.Status;
        Reminders = terms.Reminders;
    }
}

/// <summary>How a client upsert applies to an existing appointment (see <see cref="Appointment.DecideUpsert"/>).</summary>
public enum AppointmentUpsertDecision
{
    /// <summary>Apply the incoming terms.</summary>
    Apply,

    /// <summary>The stored appointment changed after the client's edit; the upsert is a no-op and the stored copy is returned.</summary>
    IgnoreStale,
}
