using Lotties.Application.Stores;
using Lotties.Domain.Babies;
using Lotties.Domain.Clinical;
using Lotties.Domain.Rest;

namespace Lotties.Application.Rest;

/// <summary>
/// Reads the baby events the rest estimate needs, as plain <see cref="RestEvent"/> records: every baby the person belongs to
/// except those where she is a Doctor (design 41 section 4), each through its own store. Shared by the one-night estimate and
/// the history so both read the same events.
/// </summary>
internal sealed class RestEventReader(IBabyRepository babies, IClinicalEventRepository events, IStoreScope stores)
{
    private const string SleepKey = "sleep";
    private static readonly TimeSpan SleepIdLookBack = TimeSpan.FromHours(24);
    private static readonly string[] SleepKeys = [SleepKey];

    /// <summary>Up to <paramref name="takePerBaby"/> events per baby overlapping [<paramref name="from"/>, <paramref name="to"/>).</summary>
    public async Task<IReadOnlyList<RestEvent>> ReadAsync(
        Guid userId,
        DateTimeOffset from,
        DateTimeOffset to,
        int takePerBaby,
        CancellationToken cancellationToken = default)
    {
        var result = new List<RestEvent>();
        foreach (var baby in await babies.ListForUserAsync(userId, cancellationToken))
        {
            if (baby.Members.SingleOrDefault(member => member.UserId == userId) is not { } membership || membership.Role.IsDoctor())
            {
                continue;
            }

            result.AddRange(await ReadBabyAsync(baby.Id, from, to, takePerBaby, cancellationToken));
        }

        return result;
    }

    private async Task<IEnumerable<RestEvent>> ReadBabyAsync(Guid babyId, DateTimeOffset from, DateTimeOffset to, int take, CancellationToken cancellationToken)
    {
        await stores.EnterAsync(babyId, cancellationToken);
        var sleepIds = (await events.ListByTypesAsync(babyId, SleepKeys, from - SleepIdLookBack, to, cancellationToken))
            .Select(item => item.Event.Id)
            .ToHashSet();
        var overlapping = await events.ListOverlappingAsync(babyId, from, to, take, [], cancellationToken);
        return overlapping.Select(item => new RestEvent(
            item.BabyId,
            sleepIds.Contains(item.Id),
            item.StartedAt,
            item.EndedAt,
            item.CreatedBy,
            item.CreatedAt,
            false));
    }
}
