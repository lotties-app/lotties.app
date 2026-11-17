using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>
/// Chains multiple <see cref="IPriorProvider"/> instances in priority order, returning the first non-null prior. This
/// enables fallback strategies such as PublishedNorm > CommunityStatic > CommunityLive. Pure, no I/O.
/// </summary>
internal sealed class CompositePriorProvider : IPriorProvider
{
    private readonly IReadOnlyList<IPriorProvider> _providers;

    public CompositePriorProvider(IReadOnlyList<IPriorProvider> providers)
    {
        ArgumentNullException.ThrowIfNull(providers);
        _providers = providers;
    }

    public ColdStartPrior? GetPrior(EventTypeKey typeKey, int ageDays)
    {
        foreach (var provider in _providers)
        {
            var prior = provider.GetPrior(typeKey, ageDays);
            if (prior is not null)
            {
                return prior;
            }
        }

        return null;
    }
}