using Lotties.Application.SilentPush;
using Lotties.Domain.Notifications;
using Lotties.Domain.SilentPush;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// The unique <c>token_hash</c> index decides concurrent registrations of one token (<see cref="TryAddAsync"/>).
/// Housekeeping revokes with set-based updates that touch only active rows, so the first revoke reason is kept as
/// <see cref="SilentPushDevice.Revoke"/> does. The recipients query leaves out a baby whose records are on an external
/// store (the reminders' rule, docs/design/47-bring-your-own-database.md D9) by its control-plane pointer.
/// </remarks>
internal sealed class EfSilentPushDeviceRepository(LottiesDbContext context, UniqueViolations uniqueViolations) : ISilentPushDeviceRepository
{
    public Task<SilentPushDevice?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken = default) =>
        context.SilentPushDevices.SingleOrDefaultAsync(device => device.TokenHash == tokenHash, cancellationToken);

    public Task<SilentPushDevice?> FindForUserAsync(Guid userId, Guid deviceId, CancellationToken cancellationToken = default) =>
        context.SilentPushDevices.SingleOrDefaultAsync(device => device.Id == deviceId && device.UserId == userId, cancellationToken);

    public async Task<IReadOnlyList<SilentPushDevice>> ListActiveForUserAsync(Guid userId, CancellationToken cancellationToken = default) =>
        await context.SilentPushDevices
            .Where(device => device.UserId == userId && device.RevokedAt == null)
            .OrderByDescending(device => device.LastSeenAt)
            .ThenBy(device => device.Id)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<SilentPushRecipient>> ListRecipientsAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var rows = await RecipientsQuery(context, babyId).ToListAsync(cancellationToken);
        return rows.Select(row => new SilentPushRecipient(row.Device, row.Role)).ToArray();
    }

    public Task<bool> TryAddAsync(SilentPushDevice device, CancellationToken cancellationToken = default) =>
        UniqueInserts.TryInsertAsync(context, uniqueViolations, device, cancellationToken);

    public Task<int> RevokeNotSeenSinceAsync(DateTimeOffset seenBefore, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        DateTimeOffset? revokedAt = now.ToUniversalTime();
        SubscriptionRevokeReason? revokedReason = SubscriptionRevokeReason.Inactive;
        return context.SilentPushDevices
            .Where(device => device.RevokedAt == null && device.LastSeenAt < seenBefore)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(device => device.RevokedAt, revokedAt)
                    .SetProperty(device => device.RevokedReason, revokedReason),
                cancellationToken);
    }

    public Task<int> DeleteRevokedBeforeAsync(DateTimeOffset revokedBefore, CancellationToken cancellationToken = default) =>
        context.SilentPushDevices
            .Where(device => device.RevokedAt != null && device.RevokedAt < revokedBefore)
            .ExecuteDeleteAsync(cancellationToken);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) => context.SaveChangesAsync(cancellationToken);

    /// <summary>
    /// The active devices of the baby's members and their role, the baby not on an external store; a tracking query (a
    /// member row is tracked with it: <c>AsNoTracking</c> on any part would untrack the devices too). Exposed for SQL
    /// translation tests.
    /// </summary>
    internal static IQueryable<RecipientRow> RecipientsQuery(LottiesDbContext context, Guid babyId) =>
        from device in context.SilentPushDevices
        join member in context.BabyMembers on device.UserId equals member.UserId
        where member.BabyId == babyId
            && device.RevokedAt == null
            && !context.BabyStoreAssignments.Any(assignment => assignment.BabyId == babyId && assignment.DataStoreId != null)
        orderby device.UserId, device.Id
        select new RecipientRow(device, member.Role);

    internal sealed record RecipientRow(SilentPushDevice Device, Domain.Babies.BabyRole Role);
}
