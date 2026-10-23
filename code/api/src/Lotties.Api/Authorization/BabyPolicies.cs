using Lotties.Domain.Babies;

namespace Lotties.Api.Authorization;

/// <summary>
/// Authorization policies for routes under <see cref="Endpoints.BabyRoutes.Prefix"/>, evaluated against the
/// caller's <c>BabyMember</c> role for the <c>{babyId}</c> route value.
/// </summary>
/// <remarks>
/// Unauthenticated requests get 401. Authenticated callers who are not members of the baby (or when the baby does
/// not exist) get 403, the same as members whose role is too low, so the API does not reveal which baby ids exist.
/// </remarks>
public static class BabyPolicies
{
    /// <summary>Any member (Viewer, Caregiver, Parent, Owner, Doctor).</summary>
    public const string Read = "BabyRead";

    /// <summary>
    /// Family members only (Owner, Parent, Caregiver, Viewer; never the Doctor): the family's non-clinical records, the
    /// appointments (every route) and the members list. A Doctor gets 403 (docs/design/16-doctor-access.md, "Doctor read
    /// audit").
    /// </summary>
    public const string ReadFamily = "BabyReadFamily";

    /// <summary>
    /// Members who can log events (Caregiver, Parent, Owner): event writes and the member's own reminder preferences.
    /// A Caregiver changes only the events they logged, checked by the event use case (403 <c>event_not_owned</c>).
    /// </summary>
    public const string Log = "BabyLog";

    /// <summary>Members who can write (Parent, Owner).</summary>
    public const string Write = "BabyWrite";

    /// <summary>Members who can manage members and invites (Owner).</summary>
    public const string ManageMembers = "BabyManageMembers";

    /// <summary>
    /// Members who write notes (the Doctor only in v1). Only the author changes a note, checked by the use case (403
    /// <c>note_not_owned</c>).
    /// </summary>
    public const string Note = "BabyNote";

    /// <summary>
    /// Members who add growth measurements (Owner, Parent, Doctor). A Doctor changes only her own, checked by the use case
    /// (403 <c>measurement_not_owned</c>).
    /// </summary>
    public const string Measure = "BabyMeasure";

    /// <summary>
    /// Members who propose prescriptions to the parents (the Doctor only). Only the author edits or withdraws a pending
    /// proposal, checked by the use case (another doctor's is 404 <c>proposal_not_found</c>).
    /// </summary>
    public const string Propose = "BabyPropose";

    /// <summary>Prefix of the scope policies: <c>BabyScope:daily_log</c>, <c>BabyScope:growth</c>, ... (see <see cref="ForScope"/>).</summary>
    public const string ScopePrefix = "BabyScope:";

    /// <summary>The daily log (events, event types, predictions, the timeline): any member but a Doctor without the <c>daily_log</c> scope.</summary>
    public const string ScopeDailyLog = ScopePrefix + DoctorScopes.DailyLogCode;

    /// <summary>Growth measurements: any member but a Doctor without the <c>growth</c> scope.</summary>
    public const string ScopeGrowth = ScopePrefix + DoctorScopes.GrowthCode;

    /// <summary>Medications, prescriptions, the medication status and the proposals: any member but a Doctor without the <c>medications</c> scope.</summary>
    public const string ScopeMedications = ScopePrefix + DoctorScopes.MedicationsCode;

    /// <summary>Recorded vaccines: any member but a Doctor without the <c>vaccines</c> scope.</summary>
    public const string ScopeVaccines = ScopePrefix + DoctorScopes.VaccinesCode;

    /// <summary>Formulas: any member but a Doctor without the <c>formulas</c> scope.</summary>
    public const string ScopeFormulas = ScopePrefix + DoctorScopes.FormulasCode;

    /// <summary>Notes and note reads: any member but a Doctor without the <c>notes</c> scope.</summary>
    public const string ScopeNotes = ScopePrefix + DoctorScopes.NotesCode;

    /// <summary>The policy name of a doctor scope (<see cref="ScopePrefix"/> plus its code).</summary>
    public static string ForScope(DoctorScope scope) => ScopePrefix + DoctorScopes.CodeOf(scope);
}
