using Lotties.Domain.CommunityInsights;
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
}
