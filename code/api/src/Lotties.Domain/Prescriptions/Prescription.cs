using Lotties.Domain.Common;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Prescriptions;

/// <summary>
/// What the doctor prescribed for one medication of a baby's catalog, as entered by the parent: the dose rule, the
/// schedule, an optional shared interval group and the course dates. The id is client generated; sync follows the
/// events contract: <see cref="UpdatedAt"/> (server receive time) is the delta cursor, <see cref="ClientUpdatedAt"/>
/// (client edit time, bounded to the server clock + 5 min) decides conflicts, deletes are soft and always win.
/// A prescription the parents accepted from a doctor's proposal carries its provenance (<see cref="ProposalId"/>,
/// <see cref="PrescribedByUserId"/>, <see cref="PrescribedByName"/>, <see cref="OriginalSnapshot"/>); a parent may
/// still change it, which marks it <see cref="ChangedByParent"/> for good (docs/design/16-doctor-access.md 10.2).
/// </summary>
public sealed class Prescription
{
    private Prescription()
    {
    }

    private Prescription(Guid id, Guid babyId, Guid createdBy, DateTimeOffset createdAt, DateTimeOffset clientUpdatedAt)
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

    public Guid MedicationId { get; private set; }

    public PrescriptionStatus Status { get; private set; }

    public DoseRule Dose { get; private set; } = null!;

    public PrescriptionSchedule Schedule { get; private set; } = null!;

    public IntervalGroup? IntervalGroup { get; private set; }

    public DateOnly StartDate { get; private set; }

    public DateOnly? EndDate { get; private set; }

    public string? Prescriber { get; private set; }

    public string? Instructions { get; private set; }

    public Guid CreatedBy { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public DateTimeOffset ClientUpdatedAt { get; private set; }

    public DateTimeOffset? DeletedAt { get; private set; }

    /// <summary>The doctor whose accepted proposal created this prescription; <c>null</c> when a parent entered it.</summary>
    public Guid? PrescribedByUserId { get; private set; }

    /// <summary>The doctor's display name when the parents accepted (a snapshot, without a title).</summary>
    public string? PrescribedByName { get; private set; }

    /// <summary>The accepted proposal this prescription came from.</summary>
    public Guid? ProposalId { get; private set; }

    /// <summary>What the doctor's proposal said, kept after a parent's change.</summary>
    public PrescriptionSnapshot? OriginalSnapshot { get; private set; }

    /// <summary>A parent changed the content of this doctor-sourced prescription (never reset).</summary>
    public bool ChangedByParent { get; private set; }

    public bool IsDeleted => DeletedAt is not null;

    /// <summary>Whether this prescription came from a doctor's accepted proposal.</summary>
    public bool IsDoctorSourced => ProposalId is not null;

    /// <summary>Active and not deleted: the prescriptions the status calculator reports.</summary>
    public bool IsActive => Status == PrescriptionStatus.Active && !IsDeleted;

    public PrescriptionTerms Terms => PrescriptionTerms.Create(MedicationId, Status, Dose, Schedule, IntervalGroup, StartDate, EndDate, Prescriber, Instructions);

    public static Prescription Create(
        Guid id,
        Guid babyId,
        PrescriptionTerms terms,
        Guid createdBy,
        DateTimeOffset now,
        DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        var prescription = new Prescription(
            Ids.Required(id, nameof(id)),
            Ids.Required(babyId, nameof(babyId)),
            Ids.Required(createdBy, nameof(createdBy)),
            UtcTime.Normalize(now),
            ClientEditTime.Bound(clientUpdatedAt, now));
        prescription.Apply(terms);
        return prescription;
    }

    /// <summary>
    /// The prescription the parents accepted from a doctor's proposal: <paramref name="terms"/> are the proposal's terms
    /// with the resolved medication, <paramref name="provenance"/> who prescribed it and what she sent.
    /// </summary>
    public static Prescription CreateFromProposal(
        Guid id,
        Guid babyId,
        PrescriptionTerms terms,
        PrescriptionProvenance provenance,
        Guid acceptedBy,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(provenance);
        var prescription = Create(id, babyId, terms, acceptedBy, now, now);
        prescription.PrescribedByUserId = Ids.Required(provenance.PrescribedByUserId, nameof(provenance.PrescribedByUserId));
        prescription.PrescribedByName = provenance.PrescribedByName;
        prescription.ProposalId = Ids.Required(provenance.ProposalId, nameof(provenance.ProposalId));
        prescription.OriginalSnapshot = provenance.Original;
        return prescription;
    }

    /// <summary>
    /// Decides how a client upsert applies, before any change: a prescription never moves to another baby
    /// (<see cref="PrescriptionBabyMismatchException"/>), a deleted one stays deleted, and a write whose bounded client
    /// time is strictly older than <see cref="ClientUpdatedAt"/> loses (last write wins). Ties and absent times apply.
    /// </summary>
    public PrescriptionUpsertDecision DecideUpsert(Guid babyId, DateTimeOffset? clientUpdatedAt, DateTimeOffset now)
    {
        if (BabyId != babyId)
        {
            throw new PrescriptionBabyMismatchException(Id, babyId);
        }

        return this switch
        {
            { IsDeleted: true } => PrescriptionUpsertDecision.IgnoreDeleted,
            _ when clientUpdatedAt is not null && ClientEditTime.Bound(clientUpdatedAt, now) < ClientUpdatedAt => PrescriptionUpsertDecision.IgnoreStale,
            _ => PrescriptionUpsertDecision.Apply,
        };
    }

    /// <summary>
    /// Applies the full terms. Equal terms change nothing (not even the timestamps), so a replay returns the same
    /// representation; otherwise <see cref="UpdatedAt"/> becomes <paramref name="now"/> and <see cref="ClientUpdatedAt"/>
    /// the bounded client time. A content change (anything but the status) of a doctor-sourced prescription marks it
    /// <see cref="ChangedByParent"/>; stopping or resuming does not.
    /// </summary>
    public void Edit(PrescriptionTerms terms, DateTimeOffset now, DateTimeOffset? clientUpdatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (IsDeleted)
        {
            throw new PrescriptionDeletedException(Id);
        }

        var current = Terms;
        if (terms == current)
        {
            return;
        }

        ChangedByParent = ChangedByParent || (IsDoctorSourced && !terms.HasSameContentAs(current));
        Apply(terms);
        UpdatedAt = UtcTime.Normalize(now);
        ClientUpdatedAt = ClientEditTime.Bound(clientUpdatedAt, now);
    }

    /// <summary>
    /// Ends this prescription because an accepted proposal replaces it: stopped, with the course ending on
    /// <paramref name="acceptedOn"/> kept within the course (never before the start, never after the current end). A
    /// deleted prescription stays as it is. This is the lifecycle, not a parent's change: <see cref="ChangedByParent"/>
    /// is untouched. Returns whether anything changed.
    /// </summary>
    public bool EndForReplacement(DateOnly acceptedOn, DateTimeOffset now)
    {
        var endDate = CourseEndFor(acceptedOn);
        if (IsDeleted || (Status == PrescriptionStatus.Stopped && EndDate == endDate))
        {
            return false;
        }

        Status = PrescriptionStatus.Stopped;
        EndDate = endDate;
        UpdatedAt = UtcTime.Normalize(now);
        ClientUpdatedAt = UpdatedAt;
        return true;
    }

    /// <summary>Soft delete; always wins and is idempotent. Stamps <see cref="DeletedAt"/>, <see cref="UpdatedAt"/> and <see cref="ClientUpdatedAt"/> with <paramref name="now"/>.</summary>
    public void SoftDelete(DateTimeOffset now)
    {
        if (IsDeleted)
        {
            return;
        }

        var deletedAt = UtcTime.Normalize(now);
        DeletedAt = deletedAt;
        UpdatedAt = deletedAt;
        ClientUpdatedAt = deletedAt;
    }

    /// <summary>Whether <paramref name="day"/> is on or after the start date.</summary>
    public bool HasStartedOn(DateOnly day) => day >= StartDate;

    /// <summary>Whether the course ended before <paramref name="day"/> (the end date is the last day of the course).</summary>
    public bool HasEndedBefore(DateOnly day) => EndDate is { } end && day > end;

    /// <summary>Whether <paramref name="day"/> is inside the course dates.</summary>
    public bool CoversDay(DateOnly day) => HasStartedOn(day) && !HasEndedBefore(day);

    /// <summary>Whether both prescriptions belong to the same interval group.</summary>
    public bool SharesIntervalGroupWith(Prescription other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return IntervalGroup is { } group && other.IntervalGroup == group;
    }

    private DateOnly CourseEndFor(DateOnly day) =>
        day < StartDate ? StartDate
        : EndDate is { } end && end < day ? end
        : day;

    private void Apply(PrescriptionTerms terms)
    {
        MedicationId = terms.MedicationId;
        Status = terms.Status;
        Dose = terms.Dose;
        Schedule = terms.Schedule;
        IntervalGroup = terms.IntervalGroup;
        StartDate = terms.StartDate;
        EndDate = terms.EndDate;
        Prescriber = terms.Prescriber;
        Instructions = terms.Instructions;
    }
}
