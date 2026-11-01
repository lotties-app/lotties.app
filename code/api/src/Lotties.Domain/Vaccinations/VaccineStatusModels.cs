namespace Lotties.Domain.Vaccinations;

/// <summary>A recorded vaccine as the status engine sees it (deleted records are left out by the caller).</summary>
/// <param name="DoseId"><c>null</c> for a vaccine outside the schedule; an id the schedule no longer has is ignored.</param>
public sealed record VaccinationRecord(Guid Id, string? DoseId, DateOnly GivenOn);

/// <summary>Everything <see cref="VaccineStatusCalculator.Calculate"/> needs: the dates are local calendar dates.</summary>
public sealed record VaccineStatusInput(
    VaccineSchedule Schedule,
    VaccineProfile Profile,
    DateOnly BirthDate,
    IReadOnlyList<VaccinationRecord> Records,
    DateOnly Today);

/// <summary>Where a scheduled dose stands on one day.</summary>
public enum DoseState
{
    /// <summary>A record satisfies it (directly or through a combined product's covers); for a yearly dose, within the year.</summary>
    Given,

    /// <summary>Its age has come and it is not overdue (recurring doses stay due until given).</summary>
    Due,

    /// <summary>More than <see cref="VaccineStatusCalculator.OverdueAfterDays"/> days after it became due, still within the latest age.</summary>
    Overdue,

    /// <summary>Its age has not come yet (<see cref="DoseStatus.DueOn"/>), or a yearly dose waits for the first doses.</summary>
    Upcoming,

    /// <summary>Past the latest age of this schedule: shown as "no longer in the schedule, ask your pediatrician".</summary>
    Expired,

    /// <summary>Does not apply to this baby (<see cref="DoseStatus.Reason"/>).</summary>
    NotApplicable,
}

/// <summary>Why a dose does not apply.</summary>
public enum NotApplicableReason
{
    /// <summary>Another dose of its alternative group was given (<see cref="DoseStatus.AlternativeOf"/>).</summary>
    Alternative,

    /// <summary>Its condition is not met (e.g. the mother got the RSV vaccine in pregnancy).</summary>
    Condition,

    /// <summary>A private-clinic recommendation while the baby's profile shows the public schedule only.</summary>
    Network,
}

/// <summary>
/// The state of one scheduled dose. <see cref="DueOn"/> is the day it becomes (or became) due: the recommended age, or
/// later when the minimum interval after a late previous dose pushes it; <see cref="EarliestOn"/> the earliest valid day
/// the same way; <see cref="LatestOn"/> the last day of the schedule's window. A given dose names the record (and
/// <see cref="CoveredBy"/> the combined product's dose id when a covers rule satisfied it).
/// </summary>
public sealed record DoseStatus(
    string DoseId,
    string Slot,
    DoseState State,
    NotApplicableReason? Reason,
    DateOnly? DueOn,
    DateOnly? EarliestOn,
    DateOnly? LatestOn,
    DateOnly? OverdueFrom,
    Guid? RecordId,
    DateOnly? GivenOn,
    string? CoveredBy,
    string? AlternativeOf,
    bool OptionalPrivate,
    DateOnly? NextDueOn,
    string? WaitingFor);

/// <summary>The schedule of one baby on one day: every scheduled dose (record-only products left out) in file order.</summary>
public sealed record VaccineStatusResult(int AgeDays, bool PrematureNotice, IReadOnlyList<DoseStatus> Doses);
