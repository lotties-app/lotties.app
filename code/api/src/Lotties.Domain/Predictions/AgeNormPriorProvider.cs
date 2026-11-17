using Lotties.Domain.AgeNorms;
using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>
/// Resolves cold-start priors from published age norms. Wraps the existing <see cref="AgeNormSet.PriorFor"/> lookup so
/// that it can participate in an <see cref="IPriorProvider"/> chain without changing call sites.
/// </summary>
internal sealed class AgeNormPriorProvider : IPriorProvider
{
    private readonly AgeNormSet _ageNorms;

    public AgeNormPriorProvider(AgeNormSet ageNorms)
    {
        ArgumentNullException.ThrowIfNull(ageNorms);
        _ageNorms = ageNorms;
    }

    public ColdStartPrior? GetPrior(EventTypeKey typeKey, int ageDays)
    {
        if (ageDays < 0)
        {
            return null;
        }

        var metric = ColdStartMetrics.For(typeKey);
        if (metric is null)
        {
            return null;
        }

        var norm = _ageNorms.PriorFor(metric, AgeNormPopulations.All, ageDays);
        return norm is null ? null : ColdStartMetrics.FromNorm(typeKey, norm, ageDays);
    }
}