using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Babies;

/// <summary>Permission rules derived from <see cref="BabyRole"/>.</summary>
public static class BabyRoleRules
{
    /// <summary>Whether the role may create or change events, event types and medications.</summary>
    public static bool CanWrite(this BabyRole role) => role is BabyRole.Owner or BabyRole.Parent;

    /// <summary>Whether the role may manage members and invites.</summary>
    public static bool CanManageMembers(this BabyRole role) => role is BabyRole.Owner;

    internal static BabyRole EnsureDefined(BabyRole role)
    {
        if (!Enum.IsDefined(role))
        {
            throw new DomainValidationException("Role", $"Role {role} is not supported.");
        }

        return role;
    }
}
