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
        var resolution = AssistantBabyChoice.Decide(MembershipsOf(userBabies, user.Id), settings?.DefaultBabyId);
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
        _ => AssistantResultCode.NotAllowed,
    };

    private static AssistantSubjectLookup Refused(AssistantResultCode code, DateTimeOffset now) =>
        new(null, new AssistantResult { Code = code, AsOf = now });
}
