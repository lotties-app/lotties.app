namespace Lotties.Domain.Predictions;

/// <summary>A prediction interval with lower/upper bounds, median and confidence level.</summary>
public sealed record PredictionInterval(TimeSpan LowerBound, TimeSpan UpperBound, TimeSpan Median, double ConfidenceLevel)
{
    /// <summary>
    /// Builds a prediction interval from percentile-based bounds of a list of gaps. Returns <c>null</c> when the list
    /// is empty. The confidence level is the span between the two percentiles (e.g. 0.8 for P10-P90).
    /// </summary>
    public static PredictionInterval? FromPercentiles(IReadOnlyList<TimeSpan> gaps, double lowerPercentile, double upperPercentile)
    {
        if (gaps.Count == 0)
        {
            return null;
        }

        var ordered = gaps.Order().ToArray();
        var lower = WeightedStatistics.InterpolatedQuantile(ordered, lowerPercentile);
        var median = WeightedStatistics.InterpolatedQuantile(ordered, 0.5);
        var upper = WeightedStatistics.InterpolatedQuantile(ordered, upperPercentile);
        var confidence = upperPercentile - lowerPercentile;
        return new PredictionInterval(lower, upper, median, confidence);
    }
}