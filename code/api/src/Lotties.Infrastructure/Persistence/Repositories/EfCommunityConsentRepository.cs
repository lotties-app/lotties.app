using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <remarks>
/// <c>community_consents</c> is a control-plane table of the Lotties database (docs/design/47: consents stay there whatever the baby's
/// store), so it is reached through <see cref="LottiesDbContext"/> and needs no store binding.
/// </remarks>
internal sealed class EfCommunityConsentRepository(LottiesDbContext context) : ICommunityConsentRepository
{
    public async Task<CommunityConsentHistory> HistoryAsync(Guid babyId, CancellationToken cancellationToken = default) =>
        CommunityConsentHistory.Of(await context.CommunityConsents.AsNoTracking().Where(entry => entry.BabyId == babyId).ToListAsync(cancellationToken));

    /// <remarks>
    /// Reads every line and decides per baby in memory with the same rule as <see cref="CommunityConsentHistory"/> (one line per change,
    /// a handful per baby), so the population can never disagree with what a family sees.
    /// </remarks>
    public async Task<IReadOnlyList<Guid>> BabiesInForceAsync(string textVersion, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(textVersion);
        var entries = await context.CommunityConsents.AsNoTracking().ToListAsync(cancellationToken);
        return
        [
            .. entries.GroupBy(entry => entry.BabyId)
                .Select(baby => (BabyId: baby.Key, Latest: CommunityConsentHistory.Of(baby).Latest!))
                .Where(baby => baby.Latest.Action == CommunityConsentAction.Granted && string.Equals(baby.Latest.TextVersion, textVersion, StringComparison.Ordinal))
                .Select(baby => baby.BabyId)
                .Order(),
        ];
    }

    public async Task AddAsync(CommunityConsentEntry entry, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(entry);
        context.CommunityConsents.Add(entry);
        await context.SaveChangesAsync(cancellationToken);
    }

    /// <remarks>
    /// The store rule (docs/design/47-bring-your-own-database.md, row "Anonymous aggregate / community insights") is fail closed: a baby
    /// is kept only when her pointer is the built-in store and her latest move, if any, is settled. A move copying or verifying is left
    /// out whichever way it goes (the records are between stores), and so is a move in its undo window (<see cref="DataStoreMoveState.Moved"/>):
    /// the opposite move during the window is the undo, so the family's choice of store is not settled yet. A completed move and a
    /// failed one (the baby stayed on the source) leave the pointer to decide. A baby without a pointer row is not a baby any more and
    /// is left out by the same test.
    /// </remarks>
    public async Task<IReadOnlyList<Guid>> FilterEligibleBabiesAsync(IReadOnlyList<Guid> babyIds, CancellationToken cancellationToken = default)
    {
        if (babyIds.Count == 0)
        {
            return [];
        }

        var eligibleBabyIds = await context.BabyMembers.AsNoTracking()
            .Where(m => babyIds.Contains(m.BabyId) && m.Role == BabyRole.Owner)
            .Where(m => context.BabyStoreAssignments.Any(assignment => assignment.BabyId == m.BabyId && assignment.DataStoreId == null)
                        && !context.DataStoreMoves.Any(move => move.BabyId == m.BabyId
                                                               && (move.State == DataStoreMoveState.Copying
                                                                   || move.State == DataStoreMoveState.Verifying
                                                                   || move.State == DataStoreMoveState.Moved)))
            .Join(
                context.Users.AsNoTracking().Where(u => u.Issuer != User.DemoIssuer && u.Issuer != User.DeletedIssuer),
                member => member.UserId,
                user => user.Id,
                (member, _) => member.BabyId)
            .ToListAsync(cancellationToken);

        return [.. eligibleBabyIds.Order()];
    }
}
