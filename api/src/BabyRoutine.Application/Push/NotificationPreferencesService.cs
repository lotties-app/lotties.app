using BabyRoutine.Application.Notifications;
using BabyRoutine.Application.Users;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Push;

/// <summary>The caller's notification settings and per-baby reminder preferences. Every call needs push on.</summary>
public interface INotificationPreferencesService
{
    /// <summary>The caller's settings, or the defaults (time zone <c>null</c>) before the first PUT.</summary>
    Task<NotificationSettingsDto> GetSettingsAsync(CancellationToken cancellationToken = default);

    /// <summary>Stores the full state of the caller's settings (400 <c>validation_failed</c> on an unknown zone or bad quiet hours).</summary>
    Task<NotificationSettingsDto> PutSettingsAsync(NotificationSettingsDto request, CancellationToken cancellationToken = default);

    /// <summary>One entry per baby the caller belongs to, by baby name; Viewers get <c>canReceive: false</c>.</summary>
    Task<IReadOnlyList<BabyNotificationPreferencesResponse>> ListPreferencesAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Stores the caller's full reminder preferences for the baby. The caller must already be authorized as Parent or
    /// Owner of the baby (Viewers never receive baby reminders).
    /// </summary>
    Task<BabyNotificationPreferencesResponse> PutPreferencesAsync(Guid babyId, PutBabyNotificationPreferencesRequest request, CancellationToken cancellationToken = default);
}

internal sealed class NotificationPreferencesService : INotificationPreferencesService
{
    private readonly IUserNotificationSettingsRepository _settings;
    private readonly IBabyNotificationPreferencesRepository _preferences;
    private readonly IBabyRepository _babies;
    private readonly IPushConfiguration _configuration;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<NotificationPreferencesService> _logger;

    public NotificationPreferencesService(
        IUserNotificationSettingsRepository settings,
        IBabyNotificationPreferencesRepository preferences,
        IBabyRepository babies,
        IPushConfiguration configuration,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<NotificationPreferencesService> logger)
    {
        _settings = settings ?? throw new ArgumentNullException(nameof(settings));
        _preferences = preferences ?? throw new ArgumentNullException(nameof(preferences));
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<NotificationSettingsDto> GetSettingsAsync(CancellationToken cancellationToken = default)
    {
        _configuration.EnsureEnabled();
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var stored = await _settings.FindAsync(user.Id, cancellationToken);
        return stored is null ? NotificationSettingsDto.Defaults : stored;
    }

    public async Task<NotificationSettingsDto> PutSettingsAsync(NotificationSettingsDto request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        _configuration.EnsureEnabled();
        var terms = (NotificationSettingsTerms)request;
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var stored = await _settings.FindAsync(user.Id, cancellationToken);
        var saved = stored is null
            ? await CreateSettingsAsync(user.Id, terms, cancellationToken)
            : await ChangeSettingsAsync(stored, terms, cancellationToken);
        return saved;
    }

    public async Task<IReadOnlyList<BabyNotificationPreferencesResponse>> ListPreferencesAsync(CancellationToken cancellationToken = default)
    {
        _configuration.EnsureEnabled();
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var babies = await _babies.ListForUserAsync(user.Id, cancellationToken);
        var stored = (await _preferences.ListForUserAsync(user.Id, cancellationToken)).ToDictionary(preferences => preferences.BabyId);
        return babies.Select(baby => PreferencesOf(baby, user.Id, stored)).ToArray();
    }

    public async Task<BabyNotificationPreferencesResponse> PutPreferencesAsync(Guid babyId, PutBabyNotificationPreferencesRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        _configuration.EnsureEnabled();
        var preferences = (ReminderPreferences)request;
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var stored = await _preferences.FindAsync(babyId, user.Id, cancellationToken);
        var saved = stored is null
            ? await CreatePreferencesAsync(babyId, user.Id, preferences, cancellationToken)
            : await ChangePreferencesAsync(stored, preferences, cancellationToken);
        return BabyNotificationPreferencesResponse.For(babyId, canReceive: true, saved.Preferences);
    }

    private async Task<UserNotificationSettings> CreateSettingsAsync(Guid userId, NotificationSettingsTerms terms, CancellationToken cancellationToken)
    {
        var created = UserNotificationSettings.Create(userId, terms, _timeProvider.GetUtcNow());
        if (await _settings.TryAddAsync(created, cancellationToken))
        {
            _logger.LogInformation("User {UserId} saved notification settings", userId);
            return created;
        }

        var winner = await _settings.FindAsync(userId, cancellationToken)
            ?? throw new InvalidOperationException($"Notification settings of user {userId} were reported as existing but could not be loaded.");
        return await ChangeSettingsAsync(winner, terms, cancellationToken);
    }

    private async Task<UserNotificationSettings> ChangeSettingsAsync(UserNotificationSettings stored, NotificationSettingsTerms terms, CancellationToken cancellationToken)
    {
        stored.Change(terms, _timeProvider.GetUtcNow());
        await _settings.SaveChangesAsync(cancellationToken);
        return stored;
    }

    private async Task<BabyNotificationPreferences> CreatePreferencesAsync(Guid babyId, Guid userId, ReminderPreferences preferences, CancellationToken cancellationToken)
    {
        var created = BabyNotificationPreferences.Create(babyId, userId, preferences, _timeProvider.GetUtcNow());
        if (await _preferences.TryAddAsync(created, cancellationToken))
        {
            _logger.LogInformation("User {UserId} saved reminder preferences for baby {BabyId}", userId, babyId);
            return created;
        }

        var winner = await _preferences.FindAsync(babyId, userId, cancellationToken)
            ?? throw new InvalidOperationException($"Reminder preferences of user {userId} for baby {babyId} were reported as existing but could not be loaded.");
        return await ChangePreferencesAsync(winner, preferences, cancellationToken);
    }

    private async Task<BabyNotificationPreferences> ChangePreferencesAsync(BabyNotificationPreferences stored, ReminderPreferences preferences, CancellationToken cancellationToken)
    {
        stored.Change(preferences, _timeProvider.GetUtcNow());
        await _preferences.SaveChangesAsync(cancellationToken);
        return stored;
    }

    private static BabyNotificationPreferencesResponse PreferencesOf(Baby baby, Guid userId, IReadOnlyDictionary<Guid, BabyNotificationPreferences> stored)
    {
        var member = baby.FindMember(userId) ?? throw new MemberNotFoundException(baby.Id, userId);
        var canReceive = NotificationRules.CanReceive(member.Role);
        var preferences = canReceive && stored.TryGetValue(baby.Id, out var row) ? row.Preferences : ReminderPreferences.Default;
        return BabyNotificationPreferencesResponse.For(baby.Id, canReceive, preferences);
    }
}
