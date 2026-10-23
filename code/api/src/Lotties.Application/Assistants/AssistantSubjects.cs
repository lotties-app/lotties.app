using Lotties.Application.Notifications;
using Lotties.Application.Users;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Notifications;

namespace Lotties.Application.Assistants;

/// <summary>What a command needs from the caller: write (log events) or read (any family role).</summary>
internal enum AssistantAccess
{
    Read,
    Log,
}

/// <summary>The baby a command acts on, the caller's role, the zone to tell local times in and the command's clock.</summary>
internal sealed record AssistantSubject(Baby Baby, BabyRole Role, TimeZoneInfo? Zone, string? ZoneId, DateTimeOffset Now)
{
    /// <summary>A result about this subject's baby.</summary>
    public AssistantResult Result(AssistantResultCode code) =>
        new() { Code = code, AsOf = Now, Baby = new AssistantBaby(Baby.Id, Baby.Name), TimeZone = ZoneId };
}

/// <summary>Either the subject, or the result that refuses the command.</summary>
internal sealed record AssistantSubjectLookup(AssistantSubject? Subject, AssistantResult? Refusal);

/// <summary>One of the user's family memberships with her role, and whether it is the baby commands use by default.</summary>
internal sealed record AssistantFamilyMember(Baby Baby, BabyRole Role, bool IsDefault);

/// <summary>Either the user's family memberships (at least one), or the result that refuses listing them.</summary>
internal sealed record AssistantFamilyLookup(IReadOnlyList<AssistantFamilyMember> Members, AssistantResult? Refusal, DateTimeOffset Now);

/// <summary>
/// Resolves the subject of a command for the current user: her family memberships and stored default
/// (<see cref="AssistantBabyChoice"/>), the role the command needs, and her time zone (the one stored with her notification
/// settings, else the adapter's fallback).
/// </summary>
internal sealed class AssistantSubjects(
    ICurrentUser currentUser,
    IBabyRepository babies,
    IUserAssistantSettingsRepository assistantSettings,
    IUserNotificationSettingsRepository notificationSettings,
    TimeProvider timeProvider)
{
    public async Task<AssistantSubjectLookup> LoadAsync(AssistantInvocation invocation, AssistantAccess access, CancellationToken cancellationToken = default)
    {
        invocation.EnsureValid();
        var now = timeProvider.GetUtcNow();
        var user = await currentUser.GetUserAsync(cancellationToken);
        var userBabies = await babies.ListForUserAsync(user.Id, cancellationToken);
        var settings = await assistantSettings.FindAsync(user.Id, cancellationToken);
        var resolution = AssistantBabyChoice.Decide(MembershipsOf(userBabies, user.Id), settings?.DefaultBabyId, invocation.BabyId);
        if (resolution.BabyId is not { } babyId)
        {
            return Refused(Refusal(resolution.Outcome), now);
        }

        var baby = userBabies.Single(candidate => candidate.Id == babyId);
        var zoneId = await ZoneIdAsync(user.Id, invocation.FallbackTimeZone, cancellationToken);
        var subject = new AssistantSubject(baby, RoleOf(baby, user.Id), ZoneOf(zoneId), zoneId, now);
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
            .OrderBy(baby => baby.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(baby => baby.Id)
            .Select(baby => new AssistantFamilyMember(baby, RoleOf(baby, user.Id), baby.Id == resolution.BabyId))
            .ToArray();
        return new AssistantFamilyLookup(family, null, now);
    }

    private async Task<string?> ZoneIdAsync(Guid userId, string? fallback, CancellationToken cancellationToken)
    {
        var stored = await notificationSettings.FindAsync(userId, cancellationToken);
        var storedZone = stored?.TimeZone.Value;
        return !string.IsNullOrEmpty(storedZone) ? storedZone : KnownZoneOrNull(fallback);
    }

    private static string? KnownZoneOrNull(string? zoneId) => NotificationTimeZone.TryFrom(zoneId, out var zone) ? zone.Value : null;

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
