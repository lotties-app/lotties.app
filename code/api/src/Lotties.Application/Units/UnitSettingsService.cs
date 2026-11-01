using Lotties.Application.Users;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Units;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Units;

/// <summary>The caller's measurement unit setting as the API tells it: <c>auto</c>, <c>metric</c> or <c>us</c>.</summary>
public sealed record UnitSettingsResponse(string System)
{
    public static readonly UnitSettingsResponse Auto = new(UnitSystems.AutoName);

    public static implicit operator UnitSettingsResponse(UserUnitSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new UnitSettingsResponse(UnitSystems.NameOf(settings.Setting));
    }
}

/// <summary>Body of <c>PUT /me/unit-settings</c> (full state): <c>auto</c>, <c>metric</c> or <c>us</c>.</summary>
public sealed record SaveUnitSettingsRequest
{
    public string? System { get; init; }
}

/// <summary>The current user's measurement unit setting (docs/design/37-measurement-units.md).</summary>
public interface IUnitSettingsService
{
    /// <summary>The stored setting, or <c>auto</c> before the first PUT.</summary>
    Task<UnitSettingsResponse> GetMineAsync(CancellationToken cancellationToken = default);

    /// <summary>Stores the setting; an unknown value is 400 <c>validation_failed</c> with field <c>system</c>. Saving the same value changes nothing.</summary>
    Task<UnitSettingsResponse> SaveMineAsync(SaveUnitSettingsRequest request, CancellationToken cancellationToken = default);
}

internal sealed class UnitSettingsService(
    ICurrentUser currentUser,
    IUserUnitSettingsRepository settings,
    TimeProvider timeProvider,
    ILogger<UnitSettingsService> logger) : IUnitSettingsService
{
    public const string SystemField = "system";

    public async Task<UnitSettingsResponse> GetMineAsync(CancellationToken cancellationToken = default)
    {
        var user = await currentUser.GetUserAsync(cancellationToken);
        var stored = await settings.FindAsync(user.Id, cancellationToken);
        return stored is null ? UnitSettingsResponse.Auto : stored;
    }

    public async Task<UnitSettingsResponse> SaveMineAsync(SaveUnitSettingsRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (!UnitSystems.TryParse(request.System, out var setting))
        {
            throw new DomainValidationException(SystemField, "system must be one of: auto, metric, us.");
        }

        var user = await currentUser.GetUserAsync(cancellationToken);
        var now = timeProvider.GetUtcNow();
        var stored = await settings.FindAsync(user.Id, cancellationToken) ?? await CreateOrLoadWinnerAsync(user.Id, setting, now, cancellationToken);
        stored.Change(setting, now);
        await settings.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Saved the unit setting of user {UserId}", user.Id);
        return stored;
    }

    /// <summary>Adds the first setting; when a concurrent PUT added it first, loads that row (the caller then applies its change).</summary>
    private async Task<UserUnitSettings> CreateOrLoadWinnerAsync(Guid userId, UnitSetting setting, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var created = UserUnitSettings.Create(userId, setting, now);
        return await settings.TryAddAsync(created, cancellationToken)
            ? created
            : await settings.FindAsync(userId, cancellationToken)
                ?? throw new InvalidOperationException($"The unit setting of user {userId} was saved concurrently but could not be loaded.");
    }
}
