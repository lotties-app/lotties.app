using BabyRoutine.Domain.Common;

namespace BabyRoutine.Domain.Events;

/// <summary>
/// Bounds a client-supplied edit time: absent, or more than <see cref="MaxFutureSkew"/> ahead of the server clock, it
/// becomes the server time; otherwise it is kept (UTC, microseconds). Times in the past are trusted as they are, so
/// edits made offline keep their order when they are pushed later.
/// </summary>
internal static class ClientEditTime
{
    public static readonly TimeSpan MaxFutureSkew = TimeSpan.FromMinutes(5);

    public static DateTimeOffset Bound(DateTimeOffset? clientTime, DateTimeOffset now)
    {
        var serverNow = UtcTime.Normalize(now);
        return clientTime is { } value && value <= serverNow + MaxFutureSkew
            ? UtcTime.Normalize(value)
            : serverNow;
    }
}
