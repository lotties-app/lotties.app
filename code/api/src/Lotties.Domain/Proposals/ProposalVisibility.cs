using Lotties.Domain.Babies;

namespace Lotties.Domain.Proposals;

/// <summary>Which proposals of a baby a member sees (enforced in every read, the queries included).</summary>
public enum ProposalAudience
{
    /// <summary>Every proposal of the baby (Owner, Parent).</summary>
    All,

    /// <summary>Only the proposals she wrote (a Doctor).</summary>
    Own,

    /// <summary>None (Caregiver, Viewer).</summary>
    None,
}

/// <summary>
/// Who sees prescription proposals (docs/design/16-doctor-access.md section 10.1): Owners and Parents decide, so they
/// see all of them; a Doctor sees only her own (and their statuses); Caregivers and Viewers see none.
/// </summary>
public static class ProposalVisibility
{
    public static ProposalAudience AudienceOf(BabyRole role) =>
        role.CanWrite() ? ProposalAudience.All
        : role.IsDoctor() ? ProposalAudience.Own
        : ProposalAudience.None;

    /// <summary>Whether a member with <paramref name="role"/> and id <paramref name="userId"/> sees a proposal written by <paramref name="authorUserId"/>.</summary>
    public static bool Sees(BabyRole role, Guid userId, Guid authorUserId) => AudienceOf(role) switch
    {
        ProposalAudience.All => true,
        ProposalAudience.Own => authorUserId == userId,
        _ => false,
    };

    /// <summary>Whether the role decides (accepts or declines) proposals: Owner and Parent.</summary>
    public static bool CanDecide(BabyRole role) => role.CanWrite();

    /// <summary>Whether the role proposes prescriptions: the Doctor.</summary>
    public static bool CanPropose(BabyRole role) => role.IsDoctor();
}
