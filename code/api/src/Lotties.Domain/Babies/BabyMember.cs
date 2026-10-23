namespace Lotties.Domain.Babies;

/// <summary>A user's membership on a baby. Part of the <see cref="Baby"/> aggregate.</summary>
public sealed class BabyMember
{
    private BabyMember()
    {
    }

    internal BabyMember(Guid babyId, Guid userId, BabyRole role, DateTimeOffset joinedAt, DoctorScopeSet? doctorScopes = null)
    {
        Id = Guid.NewGuid();
        BabyId = babyId;
        UserId = userId;
        Role = role;
        JoinedAt = joinedAt;
        DoctorScopes = role.IsDoctor() ? doctorScopes : null;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    public Guid UserId { get; private set; }

    public BabyRole Role { get; private set; }

    public DateTimeOffset JoinedAt { get; private set; }

    /// <summary>
    /// The sections a Doctor member was limited to, or <c>null</c> for the defaults (every section). Only a Doctor has
    /// them: it is <c>null</c> for every other role, and cleared when a Doctor changes role.
    /// </summary>
    public DoctorScopeSet? DoctorScopes { get; private set; }

    /// <summary><see cref="DoctorScopes"/>, or every section when none were chosen.</summary>
    public DoctorScopeSet EffectiveDoctorScopes => DoctorScopes ?? DoctorScopeSet.All;

    public bool IsOwner => Role == BabyRole.Owner;

    internal void ChangeRole(BabyRole role)
    {
        Role = BabyRoleRules.EnsureDefined(role);
        DoctorScopes = Role.IsDoctor() ? DoctorScopes : null;
    }

    internal void ChangeDoctorScopes(DoctorScopeSet scopes) => DoctorScopes = scopes;

    /// <summary>
    /// Whether the member sees the <paramref name="scope"/> section: always for every role but the Doctor, whom only her
    /// <see cref="EffectiveDoctorScopes"/> open.
    /// </summary>
    public bool Sees(DoctorScope scope) => !Role.IsDoctor() || EffectiveDoctorScopes.Contains(scope);

    public bool CanWrite => Role.CanWrite();

    public bool CanLogEvents => Role.CanLogEvents();

    public bool CanManageMembers => Role.CanManageMembers();
}
