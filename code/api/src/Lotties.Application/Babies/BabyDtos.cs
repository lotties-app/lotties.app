using System.Text.Json.Serialization;
using Lotties.Application.Serialization;
using Lotties.Domain.Babies;
using Lotties.Domain.Users;

namespace Lotties.Application.Babies;

/// <summary>A baby as seen by the current user, who holds <see cref="Role"/> on it.</summary>
public sealed record BabyResponse
{
    public Guid Id { get; init; }

    public string Name { get; init; } = string.Empty;

    public DateOnly BirthDate { get; init; }

    [JsonConverter(typeof(RoleStringEnumConverter))]
    public BabyRole Role { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public static BabyResponse For(Baby baby, BabyRole role)
    {
        ArgumentNullException.ThrowIfNull(baby);
        return new BabyResponse
        {
            Id = baby.Id,
            Name = baby.Name,
            BirthDate = baby.BirthDate,
            Role = role,
            CreatedAt = baby.CreatedAt,
        };
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

    public static MemberResponse For(BabyMember member, User? user)
    {
        ArgumentNullException.ThrowIfNull(member);
        return new MemberResponse
        {
            UserId = member.UserId,
            DisplayName = user?.DisplayName ?? ExternalIdentity.FallbackDisplayName,
            Role = member.Role,
            JoinedAt = member.JoinedAt,
        };
    }
}

/// <summary>Body of <c>PATCH /api/v1/babies/{babyId}/members/{userId}</c>.</summary>
public sealed record ChangeMemberRoleRequest
{
    [JsonConverter(typeof(RoleStringEnumConverter))]
    public required BabyRole Role { get; init; }
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
            Token = issued.Token.Value,
        };
    }
}
