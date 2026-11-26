using Lotties.Domain.CommunityInsights;

namespace Lotties.Application.CommunityInsights;

/// <summary>The babies one community run may read, as taken at the start of the run.</summary>
/// <param name="InForce">Babies whose latest consent line is a yes under the current text.</param>
/// <param name="Eligible">
/// Of those, the babies with a real Owner (not a demo or deleted account) whose records are settled on the built-in store (no own
/// database, no move between stores copying, verifying or in its undo window).
/// </param>
public sealed record CommunityPopulationSnapshot(IReadOnlyList<Guid> InForce, IReadOnlyList<Guid> Eligible);

/// <summary>
/// The one consent snapshot every community run takes (docs/design/34-community-insights.md section 5 "Population"): babies with a
/// current community consent (<see cref="CommunityConsentTexts.CurrentTextVersion"/>), minus babies without a real Owner and babies not
/// settled on the built-in store (docs/design/47-bring-your-own-database.md: BYO babies are excluded; fail closed while a move is
/// unsettled). Taken once at run start, so a withdrawal takes effect on the next run. Used by <see cref="CommunityAggregationJob"/> and
/// by the community prediction aggregator, so the two can never read different populations.
/// </summary>
public static class CommunityPopulation
{
    /// <summary>Reads the snapshot; an empty consent population reads nothing else.</summary>
    public static async Task<CommunityPopulationSnapshot> SnapshotAsync(ICommunityConsentRepository consents, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(consents);
        var inForce = await consents.BabiesInForceAsync(CommunityConsentTexts.CurrentTextVersion, cancellationToken);
        if (inForce.Count == 0)
        {
            return new CommunityPopulationSnapshot(inForce, []);
        }

        var eligible = await consents.FilterEligibleBabiesAsync(inForce, cancellationToken);
        return new CommunityPopulationSnapshot(inForce, eligible);
    }
}
