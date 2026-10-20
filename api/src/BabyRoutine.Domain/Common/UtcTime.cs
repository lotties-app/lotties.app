namespace BabyRoutine.Domain.Common;

/// <summary>
/// Normalizes timestamps to UTC (offset zero) truncated to microseconds, the precision PostgreSQL
/// <c>timestamptz</c> stores, so values compare equal before and after a database round trip.
/// </summary>
internal static class UtcTime
{
    private const long TicksPerMicrosecond = TimeSpan.TicksPerMillisecond / 1000;

    public static DateTimeOffset Normalize(DateTimeOffset value)
    {
        var utcTicks = value.UtcTicks;
        return new DateTimeOffset(utcTicks - (utcTicks % TicksPerMicrosecond), TimeSpan.Zero);
    }

    public static DateTimeOffset? Normalize(DateTimeOffset? value) =>
        value is null ? null : Normalize(value.Value);
}
