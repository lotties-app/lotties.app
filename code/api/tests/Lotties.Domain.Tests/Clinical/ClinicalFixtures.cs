using Lotties.Domain.Clinical;
using Lotties.Domain.Patterns;

namespace Lotties.Domain.Tests.Clinical;

/// <summary>Clocks and windows for the clinical summary tests: local wall-clock times in 2026 turned into instants.</summary>
internal static class ClinicalFixtures
{
    /// <summary>A fixed offset of UTC-3 (no daylight saving), so local midnight is 03:00Z.</summary>
    public static readonly LocalClock Brazil = LocalClock.WithOffset(TimeSpan.FromHours(-3));

    /// <summary>A zone with daylight saving: 2026-03-08 is 23 hours long and 2026-11-01 is 25 hours long.</summary>
    public static LocalClock NewYork { get; } = LocalClock.ForZoneOrOffset("America/New_York", TimeSpan.Zero);

    public static DateTimeOffset Local(this LocalClock clock, int month, int day, int hour, int minute = 0) =>
        clock.ToInstant(new DateTime(2026, month, day, hour, minute, 0));

    public static ClinicalWindow Window(LocalClock clock, (int Month, int Day) from, (int Month, int Day) to, DateTimeOffset now) =>
        ClinicalWindow.Create(ClinicalRange.Create(new DateOnly(2026, from.Month, from.Day), new DateOnly(2026, to.Month, to.Day)), clock, now);

    public static SleepObservation Sleep(DateTimeOffset start, DateTimeOffset? end, string? kind = null, int pausedSeconds = 0, DateTimeOffset? pausedAt = null) =>
        new(start, end, kind, pausedSeconds, pausedAt);

    public static double Minutes(double milliseconds) => milliseconds / 60_000d;
}
