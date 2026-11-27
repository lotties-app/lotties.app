using Lotties.Domain.Babies;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Events;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Predictions;
using Lotties.Infrastructure.Stores;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Repositories;

/// <summary>
/// The reads of the community statistics job (docs/design/34-community-insights.md section 5.3). Subjects come from control-plane
/// tables of the Lotties database (<c>community_consents</c>, <c>babies</c>, <c>baby_members</c>, <c>users</c>) for the given ids
/// only. Events are a data-plane table: like every data-plane repository they are reached only through the scope's
/// <see cref="StoreScope"/>, and only after <see cref="StoreScope.TryEnterBuiltInAsync"/> bound the baby to the built-in store, so a
/// family's own database is never opened (docs/design/47-bring-your-own-database.md). The event query is one baby at a time, by
/// <c>(baby_id, started_at)</c> (the index of that name), for the four read type ids only; it selects the type, the two instants and
/// the payload, never the notes, the author or the id, and the global query filter leaves soft-deleted events out.
/// </summary>
/// <remarks>
/// The payload is fetched as a whole <c>jsonb</c> value and reduced in memory by <see cref="CommunityEventRows.Read"/> right after the
/// query: extracting members in SQL would need provider-specific JSON functions that the SQLite test host cannot run.
/// </remarks>
internal sealed class EfCommunityEventSource(LottiesDbContext context, StoreScope stores) : ICommunityEventSource
{
    public async Task<IReadOnlyList<CommunitySubject>> SubjectsAsync(IReadOnlyList<Guid> eligibleBabyIds, string textVersion, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(eligibleBabyIds);
        ArgumentException.ThrowIfNullOrWhiteSpace(textVersion);
        if (eligibleBabyIds.Count == 0)
        {
            return [];
        }

        var ids = eligibleBabyIds.Distinct().ToList();
        var consentedAt = await ConsentsInForceAsync(ids, textVersion, cancellationToken);
        var birthDates = await BirthDatesAsync(ids, cancellationToken);
        var families = await FamiliesAsync(ids, cancellationToken);
        return
        [
            .. ids.Where(id => consentedAt.ContainsKey(id) && birthDates.ContainsKey(id) && families.ContainsKey(id))
                .Order()
                .Select(id => new CommunitySubject(id, families[id], birthDates[id], consentedAt[id])),
        ];
    }

    public async Task<CommunityEventRows?> ReadAsync(Guid babyId, DateTimeOffset startedFrom, DateTimeOffset startedBefore, CancellationToken cancellationToken = default)
    {
        if (!await stores.TryEnterBuiltInAsync(babyId, cancellationToken))
        {
            return null;
        }

        var stored = await EventsQuery(stores.ContextFor(babyId), babyId, startedFrom, startedBefore).ToListAsync(cancellationToken);
        return CommunityEventRows.Read(stored);
    }

    /// <summary>The event query of one baby (exposed so a test can check its PostgreSQL translation).</summary>
    internal static IQueryable<CommunityStoredEvent> EventsQuery(LottiesDataDbContext data, Guid babyId, DateTimeOffset startedFrom, DateTimeOffset startedBefore)
    {
        var typeIds = CommunityEventRows.ReadTypeIds.ToList();
        var from = startedFrom.ToUniversalTime();
        var before = startedBefore.ToUniversalTime();
        return data.Events
            .AsNoTracking()
            .Where(item => item.BabyId == babyId && typeIds.Contains(item.TypeId) && item.StartedAt >= from && item.StartedAt < before)
            .Select(item => new CommunityStoredEvent(item.TypeId, item.StartedAt, item.EndedAt, item.Payload));
    }

    /// <summary>The time of each baby's latest consent line, only where that line is a yes under <paramref name="textVersion"/>.</summary>
    private async Task<IReadOnlyDictionary<Guid, DateTimeOffset>> ConsentsInForceAsync(List<Guid> ids, string textVersion, CancellationToken cancellationToken)
    {
        var entries = await context.CommunityConsents.AsNoTracking().Where(entry => ids.Contains(entry.BabyId)).ToListAsync(cancellationToken);
        return entries.GroupBy(entry => entry.BabyId)
            .Select(baby => CommunityConsentHistory.Of(baby).Latest!)
            .Where(latest => latest.Action == CommunityConsentAction.Granted && string.Equals(latest.TextVersion, textVersion, StringComparison.Ordinal))
            .ToDictionary(latest => latest.BabyId, latest => latest.At);
    }

    /// <summary>Stored birth dates of the babies whose account is not being deleted.</summary>
    private async Task<IReadOnlyDictionary<Guid, DateOnly>> BirthDatesAsync(List<Guid> ids, CancellationToken cancellationToken)
    {
        var babies = await context.Babies.AsNoTracking()
            .Where(baby => ids.Contains(baby.Id)
                && context.BabyStoreAssignments.Any(assignment => assignment.BabyId == baby.Id && assignment.AccountDeletionStartedAt == null))
            .Select(baby => new { baby.Id, baby.BirthDate })
            .ToListAsync(cancellationToken);
        return babies.ToDictionary(baby => baby.Id, baby => baby.BirthDate);
    }

    /// <summary>
    /// The family of each baby with no demo member: the babies sharing an Owner, directly or through other babies, named by the smallest
    /// baby id (the rule of the community prediction aggregator, <see cref="CommunityPredictionAggregator.FamiliesOf"/>).
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, Guid>> FamiliesAsync(List<Guid> ids, CancellationToken cancellationToken)
    {
        var members = await context.BabyMembers.AsNoTracking()
            .Where(member => ids.Contains(member.BabyId))
            .Join(context.Users.AsNoTracking(), member => member.UserId, user => user.Id, (member, user) => new { member.BabyId, member.UserId, member.Role, user.Issuer })
            .ToListAsync(cancellationToken);
        var withDemoMember = members.Where(member => member.Issuer == User.DemoIssuer).Select(member => member.BabyId).ToHashSet();
        var babies = ids.Where(id => !withDemoMember.Contains(id)).ToHashSet();
        var owners = members.Where(member => member.Role == BabyRole.Owner && babies.Contains(member.BabyId)).Select(member => (member.UserId, member.BabyId));
        return CommunityPredictionAggregator.FamiliesOf(babies, owners);
    }
}
