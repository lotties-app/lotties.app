using Lotties.Application.Users;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Assistants;

/// <summary>The caller's voice assistant settings: <c>{defaultBabyId|null, updatedAt|null}</c> (<c>updatedAt</c> null before the first PUT).</summary>
public sealed record AssistantSettingsResponse(Guid? DefaultBabyId, DateTimeOffset? UpdatedAt)
{
    public static readonly AssistantSettingsResponse Defaults = new(null, null);

    public static implicit operator AssistantSettingsResponse(UserAssistantSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return new AssistantSettingsResponse(settings.DefaultBabyId, settings.UpdatedAt);
    }
}

/// <summary>Body of <c>PUT /me/assistant-settings</c> (full state): the baby assistants use, or <c>null</c> for none.</summary>
public sealed record SaveAssistantSettingsRequest
{
    public Guid? DefaultBabyId { get; init; }
}

/// <summary>The current user's voice assistant settings (docs/design/32-assistants.md section 4).</summary>
public interface IAssistantSettingsService
{
    /// <summary>The stored settings, or the defaults (no baby) before the first PUT.</summary>
    Task<AssistantSettingsResponse> GetMineAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Stores the default baby: one the caller can log for (Owner, Parent, Caregiver), else 400 <c>validation_failed</c>
    /// with field <c>defaultBabyId</c> (also for a baby she does not belong to, so nothing tells babies apart); <c>null</c>
    /// clears it. Saving the same value changes nothing.
    /// </summary>
    Task<AssistantSettingsResponse> SaveMineAsync(SaveAssistantSettingsRequest request, CancellationToken cancellationToken = default);
}

internal sealed class AssistantSettingsService(
    ICurrentUser currentUser,
    IUserAssistantSettingsRepository settings,
    IBabyMembershipRepository memberships,
    TimeProvider timeProvider,
    ILogger<AssistantSettingsService> logger) : IAssistantSettingsService
{
    public const string DefaultBabyField = "defaultBabyId";

    public async Task<AssistantSettingsResponse> GetMineAsync(CancellationToken cancellationToken = default)
    {
        var user = await currentUser.GetUserAsync(cancellationToken);
        var stored = await settings.FindAsync(user.Id, cancellationToken);
        return stored is null ? AssistantSettingsResponse.Defaults : stored;
    }

    public async Task<AssistantSettingsResponse> SaveMineAsync(SaveAssistantSettingsRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var user = await currentUser.GetUserAsync(cancellationToken);
        await EnsureCanBeDefaultAsync(request.DefaultBabyId, user.Id, cancellationToken);
        var saved = await SaveAsync(user.Id, request.DefaultBabyId, timeProvider.GetUtcNow(), cancellationToken);
        logger.LogInformation("Saved the assistant settings of user {UserId}", user.Id);
        return saved;
    }

    private async Task EnsureCanBeDefaultAsync(Guid? babyId, Guid userId, CancellationToken cancellationToken)
    {
        if (babyId is not { } id)
        {
            return;
        }

        var member = await memberships.FindAsync(id, userId, cancellationToken);
        if (member is null || !AssistantBabyChoice.CanBeDefault(member.Role))
        {
            throw new DomainValidationException(DefaultBabyField, "defaultBabyId must be a baby you can log events for.");
        }
    }

    private async Task<UserAssistantSettings> SaveAsync(Guid userId, Guid? babyId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var stored = await settings.FindAsync(userId, cancellationToken) ?? await CreateOrLoadWinnerAsync(userId, babyId, now, cancellationToken);
        stored.ChangeDefaultBaby(babyId, now);
        await settings.SaveChangesAsync(cancellationToken);
        return stored;
    }

    /// <summary>Adds the first settings; when a concurrent PUT added them first, loads that row (the caller then applies its change).</summary>
    private async Task<UserAssistantSettings> CreateOrLoadWinnerAsync(Guid userId, Guid? babyId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var created = UserAssistantSettings.Create(userId, babyId, now);
        return await settings.TryAddAsync(created, cancellationToken)
            ? created
            : await settings.FindAsync(userId, cancellationToken)
                ?? throw new InvalidOperationException($"The assistant settings of user {userId} were saved concurrently but could not be loaded.");
    }
}
