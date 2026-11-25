using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>A prediction that was made and may later be compared against the actual next event of the same type.</summary>
/// <param name="BabyId">The baby this prediction belongs to.</param>
/// <param name="TypeKey">The event type predicted.</param>
/// <param name="PredictedAt">When (UTC) the prediction was computed.</param>
/// <param name="AnchorAt">The anchor instant (UTC) the prediction measured from.</param>
/// <param name="ExpectedNextStart">The median predicted next start (UTC).</param>
/// <param name="ActualNextStart">The actual next start (UTC), or <c>null</c> until resolved (and for an expired outcome).</param>
/// <param name="ErrorMinutes">Absolute error in minutes between expected and actual, or <c>null</c> until resolved (and for an expired outcome).</param>
/// <param name="EngineVersion">The prediction engine version that produced this outcome.</param>
/// <param name="SampleCount">Number of samples behind the prediction.</param>
/// <param name="AgeBand">The age band bucket at prediction time, if narrowed.</param>
/// <param name="Phase">The day/night phase bucket at prediction time, if narrowed.</param>
/// <param name="Expired">
/// Closed without a measurement (dropped past <see cref="PredictionOptions.MaxPendingOutcomes"/>): no longer pending, never
/// scored, so it never counts in an accuracy average.
/// </param>
internal sealed record PredictionOutcome(
    Guid Id,
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
    DayPhase? Phase,
    bool? IsRetrospective = null,
    bool? IsTopUp = null,
    bool Expired = false)
{
    /// <summary>Neither resolved nor expired: still waiting for the next actual event.</summary>
    public bool IsPending => ActualNextStart is null && !Expired;

    /// <summary>Returns a copy of this outcome with the actual next start and absolute error populated, preserving the same Id.</summary>
    public PredictionOutcome Resolve(DateTimeOffset actualNextStart)
    {
        var error = Math.Abs((actualNextStart - ExpectedNextStart).TotalMinutes);
        return this with { ActualNextStart = actualNextStart, ErrorMinutes = error, Expired = false };
    }

    /// <summary>Returns a copy closed without a measurement (no actual time, no error), preserving the same Id.</summary>
    public PredictionOutcome Expire() => this with { ActualNextStart = null, ErrorMinutes = null, Expired = true };

    /// <summary>
    /// Whether an event of this type starting at <paramref name="eventStart"/> is a better actual next start for this outcome
    /// than the one it holds: the event comes after the anchor, and the outcome is pending or was resolved by a later event
    /// (events written out of order). The first event after the anchor, by event time, is the actual next start.
    /// </summary>
    public bool IsResolvableBy(DateTimeOffset eventStart) =>
        !Expired && eventStart > AnchorAt && (ActualNextStart is null || ActualNextStart.Value > eventStart);
}
