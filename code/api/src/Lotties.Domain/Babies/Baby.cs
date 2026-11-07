using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Vaccinations;

namespace Lotties.Domain.Babies;

/// <summary>A baby and its members. A baby is always created with an owner.</summary>
public sealed class Baby
{
    public const int NameMaxLength = 100;

    private readonly List<BabyMember> _members = [];

    private Baby()
    {
    }

    private Baby(Guid id, string name, string? label, DateOnly birthDate, bool weekOnly, DateTimeOffset createdAt)
    {
        Id = id;
        Name = name;
        Label = label;
        BirthDate = birthDate;
        BirthDateWeekOnly = weekOnly;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    /// <summary>The real name; empty when the family gave none (names are optional, docs/design/45).</summary>
    public string Name { get; private set; } = string.Empty;

    /// <summary>Preset code (<see cref="BabyLabels.Presets"/>) or custom text; <c>null</c> in babies from before labels (read as <c>baby</c>).</summary>
    public string? Label { get; private set; }

    /// <summary>The name, else the label: what screens, notifications and file names show. Never spoken by assistants.</summary>
    public string ShownName => Name.Length > 0 ? Name : BabyLabels.Shown(BabyLabels.Normalize(Label));

    /// <summary>The label as resolved for clients (never null).</summary>
    public string ResolvedLabel => BabyLabels.Normalize(Label);

    public DateOnly BirthDate { get; private set; }

    /// <summary>Whether <see cref="BirthDate"/> is the Monday of the birth week (the exact day is not stored).</summary>
    public bool BirthDateWeekOnly { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public IReadOnlyCollection<BabyMember> Members => _members.AsReadOnly();

    /// <summary>Which recommendations the vaccine schedule shows (public by default).</summary>
    public VaccineCoverage VaccineCoverage { get; private set; }

    /// <summary>Weeks of gestation at birth; <c>null</c> = not told (term assumed).</summary>
    public short? GestationalAgeWeeks { get; private set; }

    /// <summary>Whether the mother got the RSV vaccine in pregnancy; <c>null</c> = not answered.</summary>
    public RsvMaternalVaccination? RsvMaternalVaccination { get; private set; }

    /// <summary>What the vaccine schedule needs to know about the baby besides the birth date.</summary>
    public VaccineProfile VaccineProfile => VaccineProfile.Create(VaccineCoverage, GestationalAgeWeeks, RsvMaternalVaccination);

    public static Baby Create(string? name, DateOnly birthDate, Guid ownerUserId, DateTimeOffset createdAt, string? label = null, bool weekOnly = false) =>
        Create(Guid.NewGuid(), name, birthDate, ownerUserId, createdAt, label, weekOnly);

    /// <summary>
    /// Creates a baby with a chosen id: the backup restore derives the id from the importer and the source baby, so
    /// restoring the same file twice finds the baby restored the first time instead of creating a second one.
    /// </summary>
    public static Baby Create(Guid id, string? name, DateOnly birthDate, Guid ownerUserId, DateTimeOffset createdAt, string? label = null, bool weekOnly = false)
    {
        Ids.Required(id, nameof(id));
        Ids.Required(ownerUserId, nameof(ownerUserId));
        var normalizedCreatedAt = UtcTime.Normalize(createdAt);
        var baby = new Baby(
            id,
            Text.Optional(name, nameof(Name), NameMaxLength) ?? string.Empty,
            label is null ? null : BabyLabels.Normalize(label),
            Stored(EnsureBirthDateNotInFuture(birthDate, normalizedCreatedAt), weekOnly),
            weekOnly,
            normalizedCreatedAt);
        baby._members.Add(new BabyMember(baby.Id, ownerUserId, BabyRole.Owner, normalizedCreatedAt));
        return baby;
    }

    /// <summary>
    /// Updates name (optional), label and birth date. The birth date is coarsened to its week when it changed, or when
    /// <paramref name="storeWeekOnly"/>; an unchanged exact date stays exact until then.
    /// </summary>
    public void UpdateDetails(string? name, DateOnly birthDate, DateTimeOffset now, string? label = null, bool storeWeekOnly = false)
    {
        var validatedName = Text.Optional(name, nameof(Name), NameMaxLength) ?? string.Empty;
        var validatedLabel = label is null ? Label : BabyLabels.Normalize(label);
        var checkedDate = EnsureBirthDateNotInFuture(birthDate, UtcTime.Normalize(now));
        if (BirthDateWeekOnly)
        {
            if (BirthWeek.MondayOf(checkedDate) != BirthDate)
            {
                BirthDate = BirthWeek.MondayOf(checkedDate);
            }
        }
        else if (checkedDate != BirthDate || storeWeekOnly)
        {
            BirthDate = BirthWeek.MondayOf(checkedDate);
            BirthDateWeekOnly = true;
        }

        Name = validatedName;
        Label = validatedLabel;
    }

    private static DateOnly Stored(DateOnly date, bool weekOnly) => weekOnly ? BirthWeek.MondayOf(date) : date;

    /// <summary>Replaces the vaccine profile (Owners and Parents, from the Vaccines page).</summary>
    public void UpdateVaccineProfile(VaccineProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);
        VaccineCoverage = profile.Coverage;
        GestationalAgeWeeks = (short?)profile.GestationalAgeWeeks;
        RsvMaternalVaccination = profile.RsvMaternalVaccination;
    }

    public BabyMember? FindMember(Guid userId) => _members.Find(member => member.UserId == userId);

    /// <summary>
    /// Adds a member. <paramref name="doctorScopes"/> limit a Doctor to some sections (<c>null</c> = the defaults, every
    /// section); for another role they are a <see cref="DomainValidationException"/> (field <c>doctorScopes</c>).
    /// </summary>
    public BabyMember AddMember(Guid userId, BabyRole role, DateTimeOffset joinedAt, DoctorScopeSet? doctorScopes = null)
    {
        Ids.Required(userId, nameof(userId));
        EnsureNotMember(userId);
        var validatedRole = BabyRoleRules.EnsureDefined(role);
        EnsureScopesFitRole(validatedRole, doctorScopes);
        var member = new BabyMember(Id, userId, validatedRole, UtcTime.Normalize(joinedAt), doctorScopes);
        _members.Add(member);
        return member;
    }

    /// <summary>
    /// Changes the role of a member. The last owner cannot be demoted; the Doctor role needs the member's declared
    /// professional profile (<paramref name="isDeclaredProfessional"/>, else <see cref="ProfessionalProfileRequiredException"/>).
    /// </summary>
    public BabyMember ChangeMemberRole(Guid userId, BabyRole role, bool isDeclaredProfessional = false)
    {
        var member = GetMember(userId);
        var newRole = BabyRoleRules.EnsureDefined(role);
        EnsureProfessionalWhenRequired(newRole, userId, isDeclaredProfessional);
        EnsureOwnerRemains(member, newRole == BabyRole.Owner);
        member.ChangeRole(newRole);
        return member;
    }

    /// <summary>
    /// Limits a Doctor member to <paramref name="scopes"/>. Throws <see cref="MemberNotFoundException"/> for a user who is
    /// not a member, and <see cref="DomainValidationException"/> (field <c>doctorScopes</c>) when the member is not a Doctor.
    /// </summary>
    public BabyMember ChangeDoctorScopes(Guid userId, DoctorScopeSet scopes)
    {
        ArgumentNullException.ThrowIfNull(scopes);
        var member = GetMember(userId);
        EnsureScopesFitRole(member.Role, scopes);
        member.ChangeDoctorScopes(scopes);
        return member;
    }

    /// <summary>Removes a member (removal by an owner or leaving). The last owner cannot be removed.</summary>
    public void RemoveMember(Guid userId)
    {
        var member = GetMember(userId);
        EnsureOwnerRemains(member, remainsOwner: false);
        _members.Remove(member);
    }

    /// <summary>
    /// Accepts <paramref name="invite"/> for <paramref name="userId"/> and adds them with the invite's role. A Doctor
    /// invite needs the user's declared professional profile (<paramref name="isDeclaredProfessional"/>, else
    /// <see cref="ProfessionalProfileRequiredException"/>, and the invite stays usable).
    /// </summary>
    public BabyMember AdmitWith(Invite invite, Guid userId, DateTimeOffset now, bool isDeclaredProfessional = false)
    {
        ArgumentNullException.ThrowIfNull(invite);
        EnsureInviteBelongsHere(invite);
        EnsureNotMember(userId);
        EnsureProfessionalWhenRequired(invite.Role, userId, isDeclaredProfessional);
        invite.Accept(userId, now);
        return AddMember(userId, invite.Role, now, invite.DoctorScopes);
    }

    private BabyMember GetMember(Guid userId) => FindMember(userId) ?? throw new MemberNotFoundException(Id, userId);

    private void EnsureOwnerRemains(BabyMember member, bool remainsOwner)
    {
        var isLastOwner = member.IsOwner && _members.Count(other => other.IsOwner) == 1;
        if (isLastOwner && !remainsOwner)
        {
            throw new LastOwnerException(Id, member.UserId);
        }
    }

    private static void EnsureScopesFitRole(BabyRole role, DoctorScopeSet? scopes)
    {
        if (scopes is not null && !role.IsDoctor())
        {
            throw new DomainValidationException(DoctorScopeSet.Field, "doctorScopes apply to the Doctor role only.");
        }
    }

    private static void EnsureProfessionalWhenRequired(BabyRole role, Guid userId, bool isDeclaredProfessional)
    {
        if (role.RequiresProfessionalProfile() && !isDeclaredProfessional)
        {
            throw new ProfessionalProfileRequiredException(userId);
        }
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

    /// <summary>
    /// The latest accepted birth date is the server's UTC date plus one day: ahead of UTC (e.g. UTC+10) the parent's
    /// local "today" is already tomorrow in UTC. Further ahead is the future everywhere.
    /// </summary>
    private static DateOnly EnsureBirthDateNotInFuture(DateOnly birthDate, DateTimeOffset now)
    {
        var latest = DateOnly.FromDateTime(now.UtcDateTime).AddDays(1);
        if (birthDate > latest)
        {
            throw new DomainValidationException(nameof(BirthDate), $"Birth date must not be after {latest:yyyy-MM-dd}.");
        }

        return birthDate;
    }
}
