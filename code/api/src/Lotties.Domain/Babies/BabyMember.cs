namespace Lotties.Domain.Babies;

/// <summary>A user's membership on a baby. Part of the <see cref="Baby"/> aggregate.</summary>
public sealed class BabyMember
{
    private BabyMember()
    {
    }

    internal BabyMember(Guid babyId, Guid userId, BabyRole role, DateTimeOffset joinedAt)
    {
        Id = Guid.NewGuid();
        BabyId = babyId;
        UserId = userId;
        Role = role;
        JoinedAt = joinedAt;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    public Guid UserId { get; private set; }

    public BabyRole Role { get; private set; }

    public DateTimeOffset JoinedAt { get; private set; }

    public bool IsOwner => Role == BabyRole.Owner;

    internal void ChangeRole(BabyRole role) => Role = BabyRoleRules.EnsureDefined(role);

    public bool CanWrite => Role.CanWrite();

    public bool CanManageMembers => Role.CanManageMembers();
}
