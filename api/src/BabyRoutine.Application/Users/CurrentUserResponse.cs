using BabyRoutine.Domain.Users;

namespace BabyRoutine.Application.Users;

/// <summary>The signed-in user, as returned by <c>GET /api/v1/me</c>.</summary>
public sealed class CurrentUserResponse
{
    public Guid Id { get; set; }

    public string DisplayName { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }

    public static implicit operator CurrentUserResponse(User user)
    {
        ArgumentNullException.ThrowIfNull(user);
        return new CurrentUserResponse
        {
            Id = user.Id,
            DisplayName = user.DisplayName,
            CreatedAt = user.CreatedAt,
        };
    }
}
