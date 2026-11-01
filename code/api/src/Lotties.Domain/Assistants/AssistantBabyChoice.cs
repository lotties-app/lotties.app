using Lotties.Domain.Babies;

namespace Lotties.Domain.Assistants;

/// <summary>One of the user's memberships as the baby choice sees it.</summary>
public sealed record AssistantMembership(Guid BabyId, BabyRole Role);

/// <summary>How the baby of an assistant command was decided.</summary>
public enum AssistantBabyOutcome
{
    /// <summary>One baby: <see cref="AssistantBabyResolution.BabyId"/>.</summary>
    Resolved,

    /// <summary>The user belongs to no baby.</summary>
    NoBaby,

    /// <summary>The user belongs to babies only as their Doctor: assistants are a family feature.</summary>
    NotAllowed,

    /// <summary>Several babies and no usable default: the user chooses one in the app (Settings, Voice assistants).</summary>
    ChooseBaby,

    /// <summary>The adapter named a baby that is not one of the user's family memberships (unknown, foreign, or hers only as Doctor).</summary>
    UnknownBaby,
}

/// <summary>The decision of <see cref="AssistantBabyChoice.Decide"/>.</summary>
public sealed record AssistantBabyResolution(AssistantBabyOutcome Outcome, Guid? BabyId)
{
    public static AssistantBabyResolution Of(Guid babyId) => new(AssistantBabyOutcome.Resolved, babyId);

    public static AssistantBabyResolution Without(AssistantBabyOutcome outcome) => new(outcome, null);
}

/// <summary>
/// Which baby an assistant command is about (docs/design/32-assistants.md section 4). Only the family's memberships count
/// (a Doctor's patients never enter the assistant, like the parents' shell): the stored default when the user is still a
/// family member of it; else the only baby the user can log for; else, when she logs for none, her only baby (read-only
/// answers); else she has to choose one. An adapter that lets the user name the baby (the MCP tools' <c>babyId</c>) passes
/// it as <c>requestedBabyId</c>: it wins when it is one of her family memberships, else the answer is
/// <see cref="AssistantBabyOutcome.UnknownBaby"/> (the same for a baby that does not exist, belongs to others, or is hers
/// only as Doctor, so nothing tells them apart).
/// </summary>
public static class AssistantBabyChoice
{
    public static AssistantBabyResolution Decide(IReadOnlyCollection<AssistantMembership> memberships, Guid? storedDefault, Guid? requestedBabyId = null)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        var family = Family(memberships);
        var loggable = family.Where(membership => membership.Role.CanLogEvents()).ToArray();
        return (memberships.Count, family.Count, loggable.Length) switch
        {
            (0, _, _) => AssistantBabyResolution.Without(AssistantBabyOutcome.NoBaby),
            (_, 0, _) => AssistantBabyResolution.Without(AssistantBabyOutcome.NotAllowed),
            _ when requestedBabyId is { } requested => family.Any(membership => membership.BabyId == requested)
                ? AssistantBabyResolution.Of(requested)
                : AssistantBabyResolution.Without(AssistantBabyOutcome.UnknownBaby),
            _ when family.FirstOrDefault(membership => membership.BabyId == storedDefault) is { } chosen => AssistantBabyResolution.Of(chosen.BabyId),
            (_, _, 1) => AssistantBabyResolution.Of(loggable[0].BabyId),
            (_, 1, 0) => AssistantBabyResolution.Of(family[0].BabyId),
            _ => AssistantBabyResolution.Without(AssistantBabyOutcome.ChooseBaby),
        };
    }

    /// <summary>Whether <paramref name="role"/> may be chosen as the default baby: a role that logs events (the settings select).</summary>
    public static bool CanBeDefault(BabyRole role) => role.CanLogEvents();

    /// <summary>The memberships assistants see: the family ones (every role but Doctor), in the given order.</summary>
    public static IReadOnlyList<AssistantMembership> Family(IEnumerable<AssistantMembership> memberships)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        return memberships.Where(membership => membership.Role.CanReadFamilyRecords()).ToArray();
    }
}
