using Lotties.Domain.Users;

namespace Lotties.Application.Users;

/// <summary>Body of <c>PUT /api/v1/me/profile</c>: the optional display name and the role label (docs/design/45).</summary>
public sealed record SaveUserProfileRequest
{
    public string? DisplayName { get; init; }

    public string? RoleLabel { get; init; }
}

/// <summary>The caller's own profile: both fields are optional; the label stands in for a missing name.</summary>
public interface IUserProfileService
{
    Task<CurrentUserResponse> SaveMineAsync(SaveUserProfileRequest request, CancellationToken cancellationToken = default);
}

internal sealed class UserProfileService(ICurrentUser currentUser, IUserRepository users) : IUserProfileService
{
    public async Task<CurrentUserResponse> SaveMineAsync(SaveUserProfileRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var user = await currentUser.GetUserAsync(cancellationToken);
        user.UpdateProfile(request.DisplayName, request.RoleLabel);
        await users.SaveChangesAsync(cancellationToken);
        return user;
    }
}
