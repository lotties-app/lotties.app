using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Babies;

/// <summary>A single-use invitation to join a baby with a given role.</summary>
public sealed class Invite
{
    private Invite()
    {
    }

    private Invite(Guid id, Guid babyId, InviteToken token, BabyRole role, Guid createdBy, DateTimeOffset createdAt, DateTimeOffset expiresAt)
    {
        Id = id;
        BabyId = babyId;
        Token = token;
        Role = role;
        CreatedBy = createdBy;
        CreatedAt = createdAt;
        ExpiresAt = expiresAt;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    /// <summary>The hash of the plain token handed to the inviter (never the plain token itself).</summary>
    public InviteToken Token { get; private set; }

    public BabyRole Role { get; private set; }

    public Guid CreatedBy { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset ExpiresAt { get; private set; }

    public DateTimeOffset? AcceptedAt { get; private set; }

    public Guid? AcceptedBy { get; private set; }

    public bool IsAccepted => AcceptedAt is not null;

    /// <summary>
    /// Issues an invite with a new random token. The invite keeps only the token's hash (<see cref="InviteToken.Hash"/>);
    /// the plain token is returned in <see cref="IssuedInvite.Token"/> and cannot be recovered later.
    /// </summary>
    public static IssuedInvite Issue(Guid babyId, BabyRole role, Guid createdBy, DateTimeOffset createdAt, TimeSpan lifetime)
    {
        Ids.Required(babyId, nameof(babyId));
        Ids.Required(createdBy, nameof(createdBy));
        EnsurePositive(lifetime);
        var normalizedCreatedAt = UtcTime.Normalize(createdAt);
        var plainToken = InviteToken.Generate();
        var invite = new Invite(
            Guid.NewGuid(),
            babyId,
            plainToken.Hash(),
            BabyRoleRules.EnsureDefined(role),
            createdBy,
            normalizedCreatedAt,
            UtcTime.Normalize(normalizedCreatedAt + lifetime));
        return new IssuedInvite(invite, plainToken);
    }

    public bool IsExpired(DateTimeOffset now) => UtcTime.Normalize(now) >= ExpiresAt;

    /// <summary>Whether the invite can still be accepted at <paramref name="now"/>.</summary>
    public bool IsPendingAt(DateTimeOffset now) => !IsAccepted && !IsExpired(now);

    /// <summary>Marks the invite as used. Prefer <see cref="Baby.AdmitWith"/>, which also adds the member.</summary>
    public void Accept(Guid userId, DateTimeOffset now)
    {
        Ids.Required(userId, nameof(userId));
        EnsureNotAccepted();
        EnsureNotExpired(now);
        AcceptedAt = UtcTime.Normalize(now);
        AcceptedBy = userId;
    }

    private void EnsureNotAccepted()
    {
        if (IsAccepted)
        {
            throw new InviteAlreadyAcceptedException(Id);
        }
    }

    private void EnsureNotExpired(DateTimeOffset now)
    {
        if (IsExpired(now))
        {
            throw new InviteExpiredException(Id, ExpiresAt);
        }
    }

    private static void EnsurePositive(TimeSpan lifetime)
    {
        if (lifetime <= TimeSpan.Zero)
        {
            throw new DomainValidationException("Lifetime", "Invite lifetime must be positive.");
        }
    }
}
