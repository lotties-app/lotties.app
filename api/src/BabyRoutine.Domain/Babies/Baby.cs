using BabyRoutine.Domain.Common;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Babies;

/// <summary>A baby and its members. A baby is always created with an owner.</summary>
public sealed class Baby
{
    public const int NameMaxLength = 100;

    private readonly List<BabyMember> _members = [];

    private Baby()
    {
    }

    private Baby(Guid id, string name, DateOnly birthDate, DateTimeOffset createdAt)
    {
        Id = id;
        Name = name;
        BirthDate = birthDate;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public DateOnly BirthDate { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public IReadOnlyCollection<BabyMember> Members => _members.AsReadOnly();

    public static Baby Create(string name, DateOnly birthDate, Guid ownerUserId, DateTimeOffset createdAt)
    {
        Ids.Required(ownerUserId, nameof(ownerUserId));
        var normalizedCreatedAt = UtcTime.Normalize(createdAt);
        var baby = new Baby(
            Guid.NewGuid(),
            Text.Required(name, nameof(Name), NameMaxLength),
            EnsureBirthDateNotInFuture(birthDate, normalizedCreatedAt),
            normalizedCreatedAt);
        baby._members.Add(new BabyMember(baby.Id, ownerUserId, BabyRole.Owner, normalizedCreatedAt));
        return baby;
    }

    public void UpdateDetails(string name, DateOnly birthDate, DateTimeOffset now)
    {
        var validatedName = Text.Required(name, nameof(Name), NameMaxLength);
        BirthDate = EnsureBirthDateNotInFuture(birthDate, UtcTime.Normalize(now));
        Name = validatedName;
    }

    public BabyMember? FindMember(Guid userId) => _members.Find(member => member.UserId == userId);

    public BabyMember AddMember(Guid userId, BabyRole role, DateTimeOffset joinedAt)
    {
        Ids.Required(userId, nameof(userId));
        EnsureNotMember(userId);
        var member = new BabyMember(Id, userId, BabyRoleRules.EnsureDefined(role), UtcTime.Normalize(joinedAt));
        _members.Add(member);
        return member;
    }

    /// <summary>Accepts <paramref name="invite"/> for <paramref name="userId"/> and adds them with the invite's role.</summary>
    public BabyMember AdmitWith(Invite invite, Guid userId, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(invite);
        EnsureInviteBelongsHere(invite);
        EnsureNotMember(userId);
        invite.Accept(userId, now);
        return AddMember(userId, invite.Role, now);
    }

    private void EnsureNotMember(Guid userId)
    {
        if (FindMember(userId) is not null)
        {
            throw new MemberAlreadyExistsException(Id, userId);
        }
    }

    private void EnsureInviteBelongsHere(Invite invite)
    {
        if (invite.BabyId != Id)
        {
            throw new ArgumentException($"Invite {invite.Id} belongs to another baby.", nameof(invite));
        }
    }

    private static DateOnly EnsureBirthDateNotInFuture(DateOnly birthDate, DateTimeOffset now)
    {
        if (birthDate > DateOnly.FromDateTime(now.UtcDateTime))
        {
            throw new DomainValidationException(nameof(BirthDate), "Birth date must not be in the future.");
        }

        return birthDate;
    }
}
