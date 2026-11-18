namespace Lotties.Infrastructure.Persistence.Entities;

/// <summary>Persistence entity for prediction accuracy tracking outcomes.</summary>
public sealed class PredictionOutcomeEntity
{
    public Guid Id { get; set; }

    public Guid BabyId { get; set; }

    public string TypeKey { get; set; } = string.Empty;

    public DateTimeOffset PredictedAt { get; set; }

    public DateTimeOffset AnchorAt { get; set; }

    public DateTimeOffset ExpectedNextStart { get; set; }

    public DateTimeOffset? ActualNextStart { get; set; }

    public double? ErrorMinutes { get; set; }

    public string EngineVersion { get; set; } = string.Empty;

    public int SampleCount { get; set; }

    public string? AgeBand { get; set; }

    public string? Phase { get; set; }

    public bool Resolved { get; set; }
}