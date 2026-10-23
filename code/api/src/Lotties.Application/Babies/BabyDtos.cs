using System.Text.Json.Serialization;
using Lotties.Application.Professionals;
using Lotties.Application.Serialization;
using Lotties.Domain.Babies;
using Lotties.Domain.Professionals;
using Lotties.Domain.Users;
using Lotties.Domain.Vaccinations;

namespace Lotties.Application.Babies;

/// <summary>A baby as seen by the current user, who holds <see cref="Role"/> on it as <see cref="UserId"/>.</summary>
public sealed record BabyResponse
{
    public Guid Id { get; init; }

    public string Name { get; init; } = string.Empty;

    public DateOnly BirthDate { get; init; }

    [JsonConverter(typeof(RoleStringEnumConverter))]
    public BabyRole Role { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>
    /// The caller's own user id (additive): the <c>createdBy</c> of the events they log, so a client can tell its own
    /// entries apart (a Caregiver may change only those) while offline.
    /// </summary>
    public Guid UserId { get; init; }

    /// <summary>
    /// The sections the caller sees when her role is Doctor (codes such as <c>daily_log</c>, <c>growth</c>, <c>medications</c>,
    /// <c>vaccines</c>, <c>formulas</c>, <c>notes</c>; the defaults are all six); <c>null</c> for every other role (additive).
    /// </summary>
    public IReadOnlyList<string>? DoctorScopes { get; init; }

    /// <summary>Which recommendations the vaccine schedule shows: <c>public</c> or <c>public+private</c> (additive).</summary>
    public string VaccineProfile { get; init; } = Domain.Vaccinations.VaccineProfile.PublicCode;

    /// <summary>Weeks of gestation at birth, or <c>null</c> (additive).</summary>
    public int? GestationalAgeWeeks { get; init; }

    /// <summary>Whether the mother got the RSV vaccine in pregnancy: <c>unknown</c>, <c>yes</c>, <c>no</c> or <c>null</c> (additive).</summary>
    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RsvMaternalVaccination? RsvMaternalVaccination { get; init; }

    public static BabyResponse For(Baby baby, BabyMember member)
    {
        ArgumentNullException.ThrowIfNull(baby);
        ArgumentNullException.ThrowIfNull(member);
        return new BabyResponse
        {
            Id = baby.Id,
            Name = baby.Name,
            BirthDate = baby.BirthDate,
            Role = member.Role,
            CreatedAt = baby.CreatedAt,
            UserId = member.UserId,
            DoctorScopes = MemberScopeCodes.Of(member),
            VaccineProfile = Domain.Vaccinations.VaccineProfile.CodeOf(baby.VaccineCoverage),
            GestationalAgeWeeks = baby.GestationalAgeWeeks,
            RsvMaternalVaccination = baby.RsvMaternalVaccination,
        };
    }
}

/// <summary>
/// Body of <c>PUT /api/v1/babies/{babyId}/vaccine-profile</c> (Owners and Parents): the full vaccine profile.
/// <c>vaccineProfile</c> is <c>public</c> or <c>public+private</c> (required); <c>gestationalAgeWeeks</c> 20-44 or
/// <c>null</c>; <c>rsvMaternalVaccination</c> <c>unknown</c>, <c>yes</c>, <c>no</c> or <c>null</c>.
/// </summary>
public sealed record UpdateVaccineProfileRequest
{
    public string? VaccineProfile { get; init; }

    public int? GestationalAgeWeeks { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RsvMaternalVaccination? RsvMaternalVaccination { get; init; }

    /// <summary>Validates; throws <see cref="Domain.Exceptions.DomainValidationException"/> naming the field.</summary>
    public static explicit operator Domain.Vaccinations.VaccineProfile(UpdateVaccineProfileRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return Domain.Vaccinations.VaccineProfile.Create(
            Domain.Vaccinations.VaccineProfile.CoverageOf(request.VaccineProfile),
            request.GestationalAgeWeeks,
            request.RsvMaternalVaccination);
    }
}

/// <summary>Body of <c>POST /api/v1/babies</c> and <c>PUT /api/v1/babies/{babyId}</c>.</summary>
public sealed record SaveBabyRequest
{
    public required string Name { get; init; }

    public required DateOnly BirthDate { get; init; }
}

/// <summary>A member of a baby with the display name of the user.</summary>
public sealed record MemberResponse
{
    public Guid UserId { get; init; }

    public string DisplayName { get; init; } = string.Empty;

    [JsonConverter(typeof(RoleStringEnumConverter))]
    public BabyRole Role { get; init; }

    public DateTimeOffset JoinedAt { get; init; }

    /// <summary>A Doctor member's professional details (additive; <c>null</c> for every other role).</summary>
    public ProfessionalSummary? Professional { get; init; }

    /// <summary>The sections a Doctor member sees (additive; <c>null</c> for every other role).</summary>
    public IReadOnlyList<string>? DoctorScopes { get; init; }

    public static MemberResponse For(BabyMember member, User? user, ProfessionalProfile? doctorProfile = null)
    {
        ArgumentNullException.ThrowIfNull(member);
        return new MemberResponse
        {
            UserId = member.UserId,
            DisplayName = user?.DisplayName ?? ExternalIdentity.FallbackDisplayName,
            Role = member.Role,
            JoinedAt = member.JoinedAt,
            Professional = member.Role.IsDoctor() && doctorProfile is not null ? (ProfessionalSummary)doctorProfile : null,
            DoctorScopes = MemberScopeCodes.Of(member),
        };
    }
}

/// <summary>
/// Body of <c>PATCH /api/v1/babies/{babyId}/members/{userId}</c>: a new <c>role</c>, new <c>doctorScopes</c> (the sections
/// a Doctor sees) or both; at least one is required, and when both are sent the role is applied first.
/// </summary>
public sealed record ChangeMemberRequest
{
    [JsonConverter(typeof(RoleStringEnumConverter))]
    public BabyRole? Role { get; init; }

    public IReadOnlyList<string?>? DoctorScopes { get; init; }
}

/// <summary>
/// Body of <c>POST /api/v1/invites/accept</c>: the plain invite token, sent in the body so it never appears in a URL
/// (request logs, proxies, browser history). A missing or malformed token is an unknown invite.
/// </summary>
public sealed record AcceptInviteRequest
{
    public string? Token { get; init; }
}

/// <summary>Body of <c>POST /api/v1/babies/{babyId}/invites</c>.</summary>
public sealed record CreateInviteRequest
{
    [JsonConverter(typeof(RoleStringEnumConverter))]
    public required BabyRole Role { get; init; }

    /// <summary>Days until the invite expires; defaults to 7, at most 30.</summary>
    public int? ExpiresInDays { get; init; }

    /// <summary>The sections a Doctor invite opens; <c>null</c> or absent = all of them. Only for the Doctor role (else 400 on <c>doctorScopes</c>).</summary>
    public IReadOnlyList<string?>? DoctorScopes { get; init; }
}

/// <summary>A pending invite. Never carries the token, which exists only in <see cref="CreatedInviteResponse"/>.</summary>
public record InviteResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    [JsonConverter(typeof(RoleStringEnumConverter))]
    public BabyRole Role { get; init; }

    public Guid CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset ExpiresAt { get; init; }

    /// <summary>The sections a Doctor invite opens (additive; <c>null</c> for every other role).</summary>
    public IReadOnlyList<string>? DoctorScopes { get; init; }

    public static implicit operator InviteResponse(Invite invite)
    {
        ArgumentNullException.ThrowIfNull(invite);
        return new InviteResponse
        {
            Id = invite.Id,
            BabyId = invite.BabyId,
            Role = invite.Role,
            CreatedBy = invite.CreatedBy,
            CreatedAt = invite.CreatedAt,
            ExpiresAt = invite.ExpiresAt,
            DoctorScopes = invite.Role.IsDoctor() ? invite.EffectiveDoctorScopes.Codes : null,
        };
    }
}

/// <summary>A newly created invite. <see cref="Token"/> is shown once; only its hash is stored.</summary>
public sealed record CreatedInviteResponse : InviteResponse
{
    public string Token { get; init; } = string.Empty;

    public static CreatedInviteResponse For(IssuedInvite issued)
    {
        ArgumentNullException.ThrowIfNull(issued);
        InviteResponse invite = issued.Invite;
        return new CreatedInviteResponse
        {
            Id = invite.Id,
            BabyId = invite.BabyId,
            Role = invite.Role,
            CreatedBy = invite.CreatedBy,
            CreatedAt = invite.CreatedAt,
            ExpiresAt = invite.ExpiresAt,
            DoctorScopes = invite.DoctorScopes,
            Token = issued.Token.Value,
        };
    }
}

/// <summary>The scope codes a response carries for a member: a Doctor's effective sections, <c>null</c> for any other role.</summary>
internal static class MemberScopeCodes
{
    public static IReadOnlyList<string>? Of(BabyMember member)
    {
        ArgumentNullException.ThrowIfNull(member);
        return member.Role.IsDoctor() ? member.EffectiveDoctorScopes.Codes : null;
    }
}
