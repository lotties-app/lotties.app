namespace Lotties.Domain.Predictions;

/// <summary>
/// The labels of the dimensions of <c>community_prediction_aggregates</c>: the one source the aggregator writes with and the reader looks
/// up and maps back with, so a stored row is always found. Age bands are <see cref="AgeBands.Label"/> (<c>0-3m</c>), phases
/// <see cref="DayPhases.Label"/> (<c>day</c>, <c>night</c>) or <c>null</c> when the cell is not narrowed by phase.
/// </summary>
public static class CommunityPredictionAggregateLabels
{
    /// <summary>The stored label of <paramref name="band"/>.</summary>
    public static string OfAgeBand(AgeBand band) => AgeBands.Label(band);

    /// <summary>The stored label of <paramref name="phase"/>, or <c>null</c> for no phase.</summary>
    public static string? OfPhase(DayPhase? phase) => phase is { } value ? DayPhases.Label(value) : null;

    /// <summary>The band a stored label names; throws for a label <see cref="OfAgeBand"/> never writes.</summary>
    public static AgeBand AgeBandOf(string label)
    {
        foreach (var band in Enum.GetValues<AgeBand>())
        {
            if (string.Equals(OfAgeBand(band), label, StringComparison.Ordinal))
            {
                return band;
            }
        }

        throw new InvalidOperationException($"Unknown age band label: {label}");
    }

    /// <summary>The phase a stored label names (<c>null</c> for none); throws for a label <see cref="OfPhase"/> never writes.</summary>
    public static DayPhase? PhaseOf(string? label)
    {
        if (label is null)
        {
            return null;
        }

        foreach (var phase in Enum.GetValues<DayPhase>())
        {
            if (string.Equals(OfPhase(phase), label, StringComparison.Ordinal))
            {
                return phase;
            }
        }

        throw new InvalidOperationException($"Unknown day phase label: {label}");
    }
}
