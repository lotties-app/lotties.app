namespace Lotties.Domain.Prescriptions;

/// <summary>Whether a prescription is in use. A stopped prescription is kept (history) but has no status.</summary>
public enum PrescriptionStatus
{
    Active,
    Stopped,
}

/// <summary>
/// <see cref="Scheduled"/>: given at fixed times of day or every N minutes. <see cref="AsNeeded"/>: given when needed,
/// no more often than a minimum interval and optionally at most N doses in 24 hours.
/// </summary>
public enum PrescriptionKind
{
    Scheduled,
    AsNeeded,
}

/// <summary>How a client upsert applies to an existing prescription (see <see cref="Prescription.DecideUpsert"/>).</summary>
public enum PrescriptionUpsertDecision
{
    /// <summary>Apply the incoming terms.</summary>
    Apply,

    /// <summary>The prescription is soft deleted; the upsert is a no-op and the deleted copy is returned.</summary>
    IgnoreDeleted,

    /// <summary>The stored prescription changed after the client's edit; the upsert is a no-op and the stored copy is returned.</summary>
    IgnoreStale,
}
