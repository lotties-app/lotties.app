using Lotties.Domain.Users;

namespace Lotties.Application.Users;

/// <summary>The signed-in user, as returned by <c>GET /api/v1/me</c>.</summary>
public sealed class CurrentUserResponse
{
    public Guid Id { get; set; }

    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Preset code or custom text shown when there is no display name; <c>null</c> when not set (additive).</summary>
    public string? RoleLabel { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public static implicit operator CurrentUserResponse(User user)
    {
        ArgumentNullException.ThrowIfNull(user);
        return new CurrentUserResponse
        {
            Id = user.Id,
            DisplayName = user.DisplayName,
            RoleLabel = user.RoleLabel,
            CreatedAt = user.CreatedAt,
        };
    }
}
