using BabyRoutine.Application.Notifications;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Notifications;
using BabyRoutine.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence.Repositories;

/// <remarks>
/// Candidates join the stored preferences with the current membership (a member removed since has no row: the
/// foreign key cascades) and an active subscription. Who may receive is decided by the domain rule
/// <see cref="NotificationRules.CanReceive"/> after loading, so a member demoted to Viewer is left out.
/// </remarks>
internal sealed class EfBabyNotificationPreferencesRepository(BabyRoutineDbContext context, UniqueViolations uniqueViolations) : IBabyNotificationPreferencesRepository
{
    public Task<BabyNotificationPreferences?> FindAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default) =>
        context.BabyNotificationPreferences.SingleOrDefaultAsync(preferences => preferences.BabyId == babyId && preferences.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<BabyNotificationPreferences>> ListForUserAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await context.BabyNotificationPreferences
            .AsNoTracking()
            .Where(preferences => preferences.UserId == userId)
            .OrderBy(preferences => preferences.BabyId)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<NotificationCandidate>> ListCandidatesAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var rows = await CandidatesQuery(context, now).ToListAsync(cancellationToken);
        return rows
            .Where(row => NotificationRules.CanReceive(row.Role))
            .Select(row => new NotificationCandidate(row.Preferences.BabyId, row.Preferences.UserId, row.Role, row.Preferences.Preferences))
            .ToArray();
    }

    public Task<bool> TryAddAsync(BabyNotificationPreferences preferences, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, preferences, cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    /// <summary>The candidate rows before the role rule; exposed for SQL translation tests.</summary>
    internal static IQueryable<CandidateRow> CandidatesQuery(BabyRoutineDbContext context, DateTimeOffset now) =>
        from preferences in context.BabyNotificationPreferences.AsNoTracking()
        join member in context.BabyMembers.AsNoTracking()
            on new { preferences.BabyId, preferences.UserId } equals new { member.BabyId, member.UserId }
        where (preferences.DoseDue || preferences.NapWindow)
            && context.PushSubscriptions.Any(subscription =>
                subscription.UserId == preferences.UserId
                && subscription.RevokedAt == null
                && (subscription.ExpiresAt == null || subscription.ExpiresAt > now))
        orderby preferences.BabyId, preferences.UserId
        select new CandidateRow(preferences, member.Role);

    internal sealed record CandidateRow(BabyNotificationPreferences Preferences, BabyRole Role);
}
