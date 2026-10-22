namespace Lotties.Domain.Predictions;

/// <summary>One finished awake stretch: from the end of a sleep session to the start of the next one.</summary>
public sealed record AwakeStretch(DateTimeOffset Start, DateTimeOffset End)
{
    public TimeSpan Length => End - Start;
}

/// <summary>
/// The baby's usual longest comfortable awake stretch (<see cref="Limit"/>, the 75th percentile of the recent daytime
/// stretches) and the awake stretch going on now, found by <see cref="WakeWindows.Measure"/>. A pattern from the log,
/// never a diagnosis.
/// </summary>
/// <param name="Limit">The percentile of <see cref="Stretches"/>, rounded to the minute.</param>
/// <param name="Stretches">The stretches the limit was computed from, oldest first.</param>
/// <param name="AwakeSince">When the current awake stretch started (the last sleep ended), or <c>null</c> while asleep or after a night waking.</param>
public sealed record WakeWindow(TimeSpan Limit, IReadOnlyList<AwakeStretch> Stretches, DateTimeOffset? AwakeSince)
{
    /// <summary>The instant the current stretch reaches the limit, or <c>null</c> without a current stretch.</summary>
    public DateTimeOffset? LimitAt => AwakeSince + Limit;

    /// <summary>How long the baby has been awake at <paramref name="now"/>, or <c>null</c> without a current stretch.</summary>
    public TimeSpan? AwakeFor(DateTimeOffset now) => now - AwakeSince;
}
