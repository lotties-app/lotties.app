namespace BabyRoutine.Domain.Predictions;

/// <summary>
/// Local clock times measured from the start of an "evening day" (<see cref="PredictionOptions.EveningDayStartsAt"/>,
/// 04:00 by default) instead of midnight, so that bed times after midnight sort after those before it: with the
/// default, 20:00 is 16h and 00:30 is 20h 30m into the evening that began on the previous calendar date.
/// </summary>
internal sealed class EveningClock(TimeSpan localOffset, TimeOnly dayStartsAt)
{
    private readonly TimeSpan _dayStart = dayStartsAt.ToTimeSpan();

    /// <summary>The local date of the evening <paramref name="instant"/> belongs to.</summary>
    public DateOnly EveningOf(DateTimeOffset instant) => DateOnly.FromDateTime(Shifted(instant).DateTime);

    /// <summary>Time since the start of the evening day of <paramref name="instant"/>, in [0, 24h).</summary>
    public TimeSpan ClockOf(DateTimeOffset instant) => Shifted(instant).TimeOfDay;

    /// <summary>The instant at <paramref name="clock"/> into the evening day <paramref name="evening"/>.</summary>
    public DateTimeOffset At(DateOnly evening, TimeSpan clock) =>
        new DateTimeOffset(evening.ToDateTime(TimeOnly.MinValue), localOffset) + _dayStart + clock;

    private DateTimeOffset Shifted(DateTimeOffset instant) => instant.ToOffset(localOffset) - _dayStart;
}
