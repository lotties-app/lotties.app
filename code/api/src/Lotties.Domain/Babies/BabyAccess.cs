namespace Lotties.Domain.Babies;

/// <summary>The outcome of checking a user's access to a baby.</summary>
public enum BabyAccessDecision
{
    /// <summary>The user is a member whose role satisfies the required role.</summary>
    Granted,

    /// <summary>The user is not a member of the baby (or the baby does not exist).</summary>
    NotMember,

    /// <summary>The user is a member, but the role is below the required role.</summary>
    InsufficientRole,

    /// <summary>The user is a Doctor whose scopes do not open the section (or the route is never open to a Doctor).</summary>
    ScopeNotGranted,
}

/// <summary>Decides baby-scoped access from a membership and the role an operation requires.</summary>
public static class BabyAccess
{
    public static BabyAccessDecision Decide(BabyMember? member, BabyRole requiredRole) => member switch
    {
        null => BabyAccessDecision.NotMember,
        _ when member.Role.Satisfies(requiredRole) => BabyAccessDecision.Granted,
        _ => BabyAccessDecision.InsufficientRole,
    };

    /// <summary>
    /// Decides access to a section: a non-member is refused; every role but the Doctor is granted (scopes limit the Doctor
    /// only); a Doctor needs <paramref name="scope"/> in her scopes, and a route without a scope (<c>null</c>) is never
    /// open to her.
    /// </summary>
    public static BabyAccessDecision DecideScope(BabyMember? member, DoctorScope? scope) => member switch
    {
        null => BabyAccessDecision.NotMember,
        _ when !member.Role.IsDoctor() => BabyAccessDecision.Granted,
        _ when scope is { } required && member.Sees(required) => BabyAccessDecision.Granted,
        _ => BabyAccessDecision.ScopeNotGranted,
    };
}
