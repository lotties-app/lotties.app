using Lotties.Domain.Patterns;

namespace Lotties.Domain.Rhythm;

/// <summary>
/// The local days a rhythm looks at: <see cref="FirstDay"/> (today minus the look-back) to <see cref="LastDay"/>
/// (yesterday), read with the family's <see cref="LocalClock"/>, and the evening day of a night.
/// </summary>
internal sealed record RhythmWindow(LocalClock Clock, DateOnly Today, DateOnly FirstDay, DateOnly LastDay, TimeOnly EveningDayStartsAt)
{
    public static RhythmWindow For(DateTimeOffset now, LocalClock clock, RhythmOptions rules)
    {
        var today = clock.DateOf(now);
        return new RhythmWindow(clock, today, today.AddDays(-rules.LookBackDays), today.AddDays(-1), rules.EveningDayStartsAt);
    }

    /// <summary>Events are read from the local start of the day before <see cref="FirstDay"/>.</summary>
    public DateTimeOffset LoadFrom => Clock.ToInstant(FirstDay.AddDays(-1).ToDateTime(TimeOnly.MinValue));

    public bool Contains(DateOnly date) => date >= FirstDay && date <= LastDay;

    /// <summary>The local date of <paramref name="instant"/>.</summary>
    public DateOnly DateOf(DateTimeOffset instant) => Clock.DateOf(instant);

    /// <summary>The evening <paramref name="instant"/> belongs to: its local date on a day starting at <see cref="EveningDayStartsAt"/>.</summary>
    public DateOnly EveningOf(DateTimeOffset instant) => DateOnly.FromDateTime(Clock.ToLocal(instant) - EveningDayStartsAt.ToTimeSpan());

    /// <summary>When the day of the evening <paramref name="evening"/> starts (its <see cref="EveningDayStartsAt"/>, local).</summary>
    public DateTimeOffset DayStartOf(DateOnly evening) => Clock.ToInstant(evening.ToDateTime(EveningDayStartsAt));

    /// <summary>The local wall-clock minute of the day of <paramref name="instant"/>.</summary>
    public int MinuteOfDay(DateTimeOffset instant)
    {
        var local = Clock.ToLocal(instant);
        return (local.Hour * 60) + local.Minute;
    }
}
