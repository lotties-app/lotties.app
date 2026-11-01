namespace Lotties.Domain.Tests;

internal static class TestClock
{
    public static readonly DateTimeOffset Now = new(2026, 1, 10, 12, 0, 0, TimeSpan.Zero);

    public static DateOnly Today => DateOnly.FromDateTime(Now.UtcDateTime);
}
