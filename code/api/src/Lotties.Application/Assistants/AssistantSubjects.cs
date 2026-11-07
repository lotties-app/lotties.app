using Lotties.Application.Consents;
using Lotties.Application.Notifications;
using Lotties.Application.Users;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.FeedingPreferences;
using Lotties.Domain.Notifications;
using Lotties.Domain.Patterns;

namespace Lotties.Application.Assistants;

/// <summary>What a command needs from the caller: write (log events) or read (any family role).</summary>
internal enum AssistantAccess
{
    Read,
    Log,
}

/// <summary>The baby a command acts on, the caller's role, the zone to tell local times in and the command's clock.</summary>
internal sealed record AssistantSubject(Baby Baby, BabyRole Role, TimeZoneInfo? Zone, string? ZoneId, DateTimeOffset Now, AssistantZoneSource ZoneSource = AssistantZoneSource.Utc, string Adapter = "", bool SayBabyName = false, bool SayMedicineNames = false, bool TimeBottleFeedings = false)
{
    /// <summary>A result about this subject's baby; the name is in it only when <see cref="SayBabyName"/> (the user's opt-in).</summary>
    public AssistantResult Result(AssistantResultCode code) =>
        new() { Code = code, AsOf = Now, Baby = new AssistantBaby(Baby.Id, SayBabyName && Baby.Name.Length > 0 ? Baby.Name : null), TimeZone = ZoneId };

    /// <summary>The user's local clock, or UTC days when no zone is known.</summary>
    public LocalClock Clock => Zone is { } zone ? LocalClock.InZone(zone) : LocalClock.WithOffset(TimeSpan.Zero);

    /// <summary>Now with the offset in force in the user's zone (UTC without one): the instant the predictions tell day from night by.</summary>
    public DateTimeOffset LocalNow => Zone is { } zone ? TimeZoneInfo.ConvertTime(Now, zone) : Now.ToUniversalTime();
}

/// <summary>Either the subject, or the result that refuses the command.</summary>
internal sealed record AssistantSubjectLookup(AssistantSubject? Subject, AssistantResult? Refusal);

/// <summary>One of the user's family memberships with her role, and whether it is the baby commands use by default.</summary>
internal sealed record AssistantFamilyMember(Baby Baby, BabyRole Role, bool IsDefault);

/// <summary>Either the user's family memberships (at least one), or the result that refuses listing them.</summary>
internal sealed record AssistantFamilyLookup(IReadOnlyList<AssistantFamilyMember> Members, AssistantResult? Refusal, DateTimeOffset Now, bool SayBabyName = false);

/// <summary>
/// Resolves the subject of a command for the current user: her family memberships and stored default
/// (<see cref="AssistantBabyChoice"/>), the role the command needs, and her time zone (<see cref="AssistantZoneChoice"/>: the
/// requested one, else the one stored with her notification settings, else the adapter's fallback, else
/// <c>America/Sao_Paulo</c> when her app language is Portuguese (Brazil): the locale of her newest push subscription, the
/// only language the server keeps).
/// </summary>
internal sealed class AssistantSubjects(
    ICurrentUser currentUser,
    IConsentService consents,
    IBabyRepository babies,
    IUserAssistantSettingsRepository assistantSettings,
    IUserFeedingSettingsRepository feedingSettings,
    IUserNotificationSettingsRepository notificationSettings,
    IPushSubscriptionRepository pushSubscriptions,
    TimeProvider timeProvider)
{
    public async Task<AssistantSubjectLookup> LoadAsync(AssistantInvocation invocation, AssistantAccess access, CancellationToken cancellationToken = default)
    {
        invocation.EnsureValid();
        var now = timeProvider.GetUtcNow();
        var user = await currentUser.GetUserAsync(cancellationToken);
        if (!await consents.HasCurrentCoreAsync(user.Id, cancellationToken))
        {
            return Refused(AssistantResultCode.ConsentRequired, now);
        }

        var userBabies = await babies.ListForUserAsync(user.Id, cancellationToken);
        var settings = await assistantSettings.FindAsync(user.Id, cancellationToken);
        var resolution = AssistantBabyChoice.Decide(MembershipsOf(userBabies, user.Id), settings?.DefaultBabyId, invocation.BabyId);
        if (resolution.BabyId is not { } babyId)
        {
            return Refused(Refusal(resolution.Outcome), now);
        }

        var baby = userBabies.Single(candidate => candidate.Id == babyId);
        var zone = await ZoneAsync(user.Id, invocation, now, cancellationToken);
        var subject = new AssistantSubject(baby, RoleOf(baby, user.Id), ZoneOf(zone.ZoneId), zone.ZoneId, now, zone.Source, invocation.Adapter, settings?.SayBabyName ?? false, settings?.SayMedicineNames ?? false, (await feedingSettings.FindAsync(user.Id, cancellationToken))?.TimeBottleFeedings ?? false);
        return Allows(subject.Role, access)
            ? new AssistantSubjectLookup(subject, null)
            : new AssistantSubjectLookup(null, subject.Result(AssistantResultCode.NotAllowed));
    }

    /// <summary>
    /// The user's family memberships (never a baby she is only the Doctor of), ordered by name then id, each flagged when
    /// it is the baby commands use without a named one; <see cref="AssistantResultCode.NoBaby"/> or
    /// <see cref="AssistantResultCode.NotAllowed"/> (only a Doctor) otherwise.
    /// </summary>
    public async Task<AssistantFamilyLookup> LoadFamilyAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default)
    {
        invocation.EnsureValid();
        var now = timeProvider.GetUtcNow();
        var user = await currentUser.GetUserAsync(cancellationToken);
        if (!await consents.HasCurrentCoreAsync(user.Id, cancellationToken))
        {
            return new AssistantFamilyLookup([], Refused(AssistantResultCode.ConsentRequired, now).Refusal, now);
        }

        var userBabies = await babies.ListForUserAsync(user.Id, cancellationToken);
        var settings = await assistantSettings.FindAsync(user.Id, cancellationToken);
        var memberships = MembershipsOf(userBabies, user.Id);
        var resolution = AssistantBabyChoice.Decide(memberships, settings?.DefaultBabyId);
        if (resolution.Outcome is AssistantBabyOutcome.NoBaby or AssistantBabyOutcome.NotAllowed)
        {
            return new AssistantFamilyLookup([], Refused(Refusal(resolution.Outcome), now).Refusal, now);
        }

        var family = AssistantBabyChoice.Family(memberships)
            .Select(membership => userBabies.Single(baby => baby.Id == membership.BabyId))
            .OrderBy(baby => baby.ShownName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(baby => baby.Id)
            .Select(baby => new AssistantFamilyMember(baby, RoleOf(baby, user.Id), baby.Id == resolution.BabyId))
            .ToArray();
        return new AssistantFamilyLookup(family, null, now, settings?.SayBabyName ?? false);
    }

    private async Task<AssistantZone> ZoneAsync(Guid userId, AssistantInvocation invocation, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var stored = await notificationSettings.FindAsync(userId, cancellationToken);
        var storedZone = stored?.TimeZone.Value;
        var appLocale = string.IsNullOrEmpty(storedZone) && !NotificationTimeZone.TryFrom(invocation.TimeZone, out _) && !NotificationTimeZone.TryFrom(invocation.FallbackTimeZone, out _)
            ? await AppLocaleAsync(userId, now, cancellationToken)
            : null;
        return AssistantZoneChoice.Decide(invocation.TimeZone, storedZone, invocation.FallbackTimeZone, appLocale);
    }

    /// <summary>The language of the user's most recently seen active push subscription (her app's language), or <c>null</c>.</summary>
    private async Task<string?> AppLocaleAsync(Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var subscriptions = await pushSubscriptions.ListActiveForUserAsync(userId, cancellationToken);
        return subscriptions.Where(subscription => subscription.IsActiveAt(now)).MaxBy(subscription => subscription.LastSeenAt)?.Locale.Value;
    }

    private static TimeZoneInfo? ZoneOf(string? zoneId) => zoneId is null ? null : TimeZoneInfo.FindSystemTimeZoneById(zoneId);

    private static bool Allows(BabyRole role, AssistantAccess access) =>
        access == AssistantAccess.Log ? role.CanLogEvents() : role.CanReadFamilyRecords();

    private static IReadOnlyCollection<AssistantMembership> MembershipsOf(IReadOnlyList<Baby> userBabies, Guid userId) =>
        userBabies.Select(baby => new AssistantMembership(baby.Id, RoleOf(baby, userId))).ToArray();

    private static BabyRole RoleOf(Baby baby, Guid userId) => baby.Members.Single(member => member.UserId == userId).Role;

    private static AssistantResultCode Refusal(AssistantBabyOutcome outcome) => outcome switch
    {
        AssistantBabyOutcome.NoBaby => AssistantResultCode.NoBaby,
        AssistantBabyOutcome.ChooseBaby => AssistantResultCode.ChooseBaby,
        AssistantBabyOutcome.UnknownBaby => AssistantResultCode.UnknownBaby,
        _ => AssistantResultCode.NotAllowed,
    };

    private static AssistantSubjectLookup Refused(AssistantResultCode code, DateTimeOffset now) =>
        new(null, new AssistantResult { Code = code, AsOf = now });
}
