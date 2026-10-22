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
    /// <summary>Any member (Viewer, Caregiver, Parent, Owner).</summary>
    public const string Read = "BabyRead";

    /// <summary>
    /// Members who can log events (Caregiver, Parent, Owner): event writes and the member's own reminder preferences.
    /// A Caregiver changes only the events they logged, checked by the event use case (403 <c>event_not_owned</c>).
    /// </summary>
    public const string Log = "BabyLog";

    /// <summary>Members who can write (Parent, Owner).</summary>
    public const string Write = "BabyWrite";

    /// <summary>Members who can manage members and invites (Owner).</summary>
    public const string ManageMembers = "BabyManageMembers";
}
