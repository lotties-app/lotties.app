namespace BabyRoutine.Domain.Babies;

/// <summary>The outcome of checking a user's access to a baby.</summary>
public enum BabyAccessDecision
{
    /// <summary>The user is a member whose role satisfies the required role.</summary>
    Granted,

    /// <summary>The user is not a member of the baby (or the baby does not exist).</summary>
    NotMember,

    /// <summary>The user is a member, but the role is below the required role.</summary>
    InsufficientRole,
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
}
