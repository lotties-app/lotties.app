namespace Lotties.Domain.Predictions;

/// <summary>A measured length (interval, awake window or duration) and the instant it is attributed to.</summary>
/// <param name="At">When the measured span began; decides its age band, day/night phase and recency weight.</param>
internal readonly record struct TimedSample(TimeSpan Length, DateTimeOffset At);
