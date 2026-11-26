namespace Lotties.Infrastructure.Persistence.Entities;

/// <summary>
/// Persistence entity for anonymized community prediction aggregates. Maps to <c>community_prediction_aggregates</c>.
/// Contains NO baby_id or personally identifiable information. Rows are written by <c>CommunityPredictionAggregator</c> (not wired)
/// only for cells of at least 20 consenting babies from 20 families that no family dominates; readers never see cells below
/// <see cref="Domain.Predictions.CommunityPredictionAggregate.MinimumCount"/>.
/// </summary>
public sealed class CommunityPredictionAggregateEntity
{
    public Guid Id { get; set; }

    /// <summary>Age band label (e.g. "0-3m", "3-6m"); written and read through <see cref="Domain.Predictions.CommunityPredictionAggregateLabels"/>.</summary>
    public string AgeBandLabel { get; set; } = string.Empty;

    /// <summary>Event type key (e.g. "sleep", "feed").</summary>
    public string TypeKey { get; set; } = string.Empty;

    /// <summary>Day phase ("day" or "night", <see cref="Domain.Predictions.CommunityPredictionAggregateLabels"/>), or null when not narrowed by phase.</summary>
    public string? Phase { get; set; }

    /// <summary>Temporal bucket identifier (ISO week, e.g. "2026-W47").</summary>
    public string TemporalBucket { get; set; } = string.Empty;

    /// <summary>Prediction engine version that produced the outcomes aggregated into this row.</summary>
    public string EngineVersion { get; set; } = string.Empty;

    /// <summary>Number of resolved outcomes in this cell. Must be >= MinimumCount at write time.</summary>
    public int Count { get; set; }

    /// <summary>Sum of absolute error values in minutes across all resolved outcomes in this cell.</summary>
    public double SumErrorMinutes { get; set; }

    /// <summary>Sum of squared error values in minutes; used to compute variance without storing individual errors.</summary>
    public double SumSquaredError { get; set; }

    /// <summary>Median absolute error in minutes, or null when not computable.</summary>
    public double? MedianErrorMinutes { get; set; }

    /// <summary>10th percentile absolute error in minutes, or null when not computable.</summary>
    public double? P10ErrorMinutes { get; set; }

    /// <summary>90th percentile absolute error in minutes, or null when not computable.</summary>
    public double? P90ErrorMinutes { get; set; }

    /// <summary>When this aggregate was generated, UTC.</summary>
    public DateTimeOffset GeneratedAtUtc { get; set; }
}