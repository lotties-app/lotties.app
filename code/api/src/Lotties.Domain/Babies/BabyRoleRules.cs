using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Babies;

/// <summary>Permission rules derived from <see cref="BabyRole"/>.</summary>
public static class BabyRoleRules
{
    /// <summary>Whether the role may create or change events of anyone, event types, medications and the other baby data.</summary>
    public static bool CanWrite(this BabyRole role) => role is BabyRole.Owner or BabyRole.Parent;

    /// <summary>Whether the role may log events (create them, and edit or delete its own): Owner, Parent and Caregiver.</summary>
    public static bool CanLogEvents(this BabyRole role) => role is BabyRole.Owner or BabyRole.Parent or BabyRole.Caregiver;

    /// <summary>
    /// Whether <paramref name="userId"/> holding <paramref name="role"/> may edit or delete an event that
    /// <paramref name="createdBy"/> logged: Owners and Parents change any event, a Caregiver only the events they logged.
    /// </summary>
    public static bool CanChangeEvent(this BabyRole role, Guid createdBy, Guid userId) =>
        role.CanWrite() || (role.CanLogEvents() && createdBy == userId);

    /// <summary>Whether the role may manage members and invites.</summary>
    public static bool CanManageMembers(this BabyRole role) => role is BabyRole.Owner;

    /// <summary>Whether the role is the healthcare professional's (<see cref="BabyRole.Doctor"/>).</summary>
    public static bool IsDoctor(this BabyRole role) => role is BabyRole.Doctor;

    /// <summary>Whether the role may write notes (only her own) on the baby: the Doctor only in v1.</summary>
    public static bool CanAuthorNotes(this BabyRole role) => role.IsDoctor();

    /// <summary>Whether the role may add growth measurements: Owner and Parent, and a Doctor (consultation measurements).</summary>
    public static bool CanRecordMeasurements(this BabyRole role) => role.CanWrite() || role.IsDoctor();

    /// <summary>
    /// Whether <paramref name="userId"/> holding <paramref name="role"/> may edit or delete a measurement that
    /// <paramref name="createdBy"/> recorded: Owners and Parents change any, a Doctor only her own.
    /// </summary>
    public static bool CanChangeMeasurement(this BabyRole role, Guid createdBy, Guid userId) =>
        role.CanWrite() || (role.IsDoctor() && createdBy == userId);

    /// <summary>Whether joining a baby with the role needs a declared professional profile (a Doctor invite or role change).</summary>
    public static bool RequiresProfessionalProfile(this BabyRole role) => role.IsDoctor();

    /// <summary>
    /// Whether <paramref name="role"/> grants at least what <paramref name="requiredRole"/> grants
    /// (Owner &gt; Parent &gt; Caregiver &gt; Viewer): Owner requires <see cref="CanManageMembers"/>, Parent requires
    /// <see cref="CanWrite"/>, Caregiver requires <see cref="CanLogEvents"/>, Viewer only requires a defined role.
    /// <see cref="BabyRole.Doctor"/> is outside that order: requiring it requires <see cref="CanAuthorNotes"/> (the
    /// Doctor herself), and a Doctor satisfies only Viewer and Doctor.
    /// </summary>
    public static bool Satisfies(this BabyRole role, BabyRole requiredRole) => EnsureDefined(requiredRole) switch
    {
        BabyRole.Owner => role.CanManageMembers(),
        BabyRole.Parent => role.CanWrite(),
        BabyRole.Caregiver => role.CanLogEvents(),
        BabyRole.Doctor => role.CanAuthorNotes(),
        _ => Enum.IsDefined(role),
    };

    internal static BabyRole EnsureDefined(BabyRole role)
    {
        if (!Enum.IsDefined(role))
        {
            throw new DomainValidationException("Role", $"Role {role} is not supported.");
        }

        return role;
    }
}
