using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.FeedingPreferences;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.FeedingPreferences;

/// <summary>
/// The caller's feeding settings: <c>{timeBottleFeedings: bool|null, updatedAt: instant|null}</c>. Both are <c>null</c> before the
/// first PUT, which lets the web tell "never saved" (it then uploads the value the person already chose on that device) from
/// "saved off"; every reader of the preference treats <c>null</c> as off.
/// </summary>
public sealed record FeedingSettingsResponse(bool? TimeBottleFeedings, DateTimeOffset? UpdatedAt)
{
    public static readonly FeedingSettingsResponse Defaults = new(null, null);

    public static implicit operator FeedingSettingsResponse(UserFeedingSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new FeedingSettingsResponse(settings.TimeBottleFeedings, settings.UpdatedAt);
    }
}

/// <summary>Body of <c>PUT /me/feeding-settings</c> (full state): <c>timeBottleFeedings</c> true or false.</summary>
public sealed record SaveFeedingSettingsRequest
{
    public bool? TimeBottleFeedings { get; init; }
}

/// <summary>The current user's feeding settings (docs/design/20-feeding-amounts.md section 3).</summary>
public interface IFeedingSettingsService
{
    /// <summary>The stored settings, or the defaults (all <c>null</c>) before the first PUT.</summary>
    Task<FeedingSettingsResponse> GetMineAsync(CancellationToken cancellationToken = default);

    /// <summary>Stores the settings; a body without <c>timeBottleFeedings</c> is 400 <c>validation_failed</c>. Saving the same value changes nothing.</summary>
    Task<FeedingSettingsResponse> SaveMineAsync(SaveFeedingSettingsRequest request, CancellationToken cancellationToken = default);
}

internal sealed class FeedingSettingsService(
    ICurrentUser currentUser,
    IUserFeedingSettingsRepository settings,
    TimeProvider timeProvider,
    ILogger<FeedingSettingsService> logger) : IFeedingSettingsService
{
    public const string TimeBottleFeedingsField = "timeBottleFeedings";

    public async Task<FeedingSettingsResponse> GetMineAsync(CancellationToken cancellationToken = default)
    {
        var user = await currentUser.GetUserAsync(cancellationToken);
        var stored = await settings.FindAsync(user.Id, cancellationToken);
        return stored is null ? FeedingSettingsResponse.Defaults : stored;
    }

    public async Task<FeedingSettingsResponse> SaveMineAsync(SaveFeedingSettingsRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.TimeBottleFeedings is not { } timeBottleFeedings)
        {
            throw new DomainValidationException(TimeBottleFeedingsField, "timeBottleFeedings must be true or false.");
        }

        var user = await currentUser.GetUserAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        var stored = await settings.FindAsync(user.Id, cancellationToken) ?? await CreateOrLoadWinnerAsync(user.Id, timeBottleFeedings, now, cancellationToken);
        stored.ChangeTimeBottleFeedings(timeBottleFeedings, now);
        await settings.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Saved the feeding settings of user {UserId}", user.Id);
        return stored;
    }

    /// <summary>Adds the first settings; when a concurrent PUT added them first, loads that row (the caller then applies its change).</summary>
    private async Task<UserFeedingSettings> CreateOrLoadWinnerAsync(Guid userId, bool timeBottleFeedings, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var created = UserFeedingSettings.Create(userId, timeBottleFeedings, now);
        return await settings.TryAddAsync(created, cancellationToken)
            ? created
            : await settings.FindAsync(userId, cancellationToken)
                ?? throw new InvalidOperationException($"The feeding settings of user {userId} were saved concurrently but could not be loaded.");
    }
}
