using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>A prediction that was made and may later be compared against the actual next event of the same type.</summary>
/// <param name="BabyId">The baby this prediction belongs to.</param>
/// <param name="TypeKey">The event type predicted.</param>
/// <param name="PredictedAt">When (UTC) the prediction was computed.</param>
/// <param name="AnchorAt">The anchor instant (UTC) the prediction measured from.</param>
/// <param name="ExpectedNextStart">The median predicted next start (UTC).</param>
/// <param name="ActualNextStart">The actual next start (UTC), or <c>null</c> until resolved.</param>
/// <param name="ErrorMinutes">Absolute error in minutes between expected and actual, or <c>null</c> until resolved.</param>
/// <param name="EngineVersion">The prediction engine version that produced this outcome.</param>
/// <param name="SampleCount">Number of samples behind the prediction.</param>
/// <param name="AgeBand">The age band bucket at prediction time, if narrowed.</param>
/// <param name="Phase">The day/night phase bucket at prediction time, if narrowed.</param>
internal sealed record PredictionOutcome(
    Guid BabyId,
    EventTypeKey TypeKey,
    DateTimeOffset PredictedAt,
    DateTimeOffset AnchorAt,
    DateTimeOffset ExpectedNextStart,
    DateTimeOffset? ActualNextStart,
    double? ErrorMinutes,
    string EngineVersion,
    int SampleCount,
    AgeBand? AgeBand,
    DayPhase? Phase)
{
    /// <summary>Returns a copy of this outcome with the actual next start and absolute error populated.</summary>
    public PredictionOutcome Resolve(DateTimeOffset actualNextStart)
    {
        var error = Math.Abs((actualNextStart - ExpectedNextStart).TotalMinutes);
        return this with { ActualNextStart = actualNextStart, ErrorMinutes = error };
    }
}