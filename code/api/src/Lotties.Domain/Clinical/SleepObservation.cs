using Lotties.Domain.Predictions;

namespace Lotties.Domain.Clinical;

/// <summary>
/// A logged sleep event as the clinical summary reads it: its start, end (<c>null</c> while it runs), payload <c>kind</c>
/// and pause keys. Callers pass only events that are not soft deleted. A <em>session</em> is a nap (kind absent or
/// <c>nap</c>) or a night (<c>night</c>); markers (<c>bed_time</c>, <c>woke_up</c>, <c>fell_asleep</c>), night wakings and
/// unknown kinds are not sleep (the parents' <c>sleepSessionKind</c>).
/// </summary>
public sealed record SleepObservation(DateTimeOffset StartedAt, DateTimeOffset? EndedAt, string? Kind, int PausedSeconds = 0, DateTimeOffset? PausedAt = null)
{
    /// <summary>Whether it is a nap or a night, which count as sleep.</summary>
    public bool IsSession => Kind is null or SleepKinds.Nap or SleepKinds.Night;

    public bool IsNight => Kind == SleepKinds.Night;

    public bool IsKind(string kind) => Kind == kind;

    public long StartMs => StartedAt.ToUnixTimeMilliseconds();

    /// <summary>The end in epoch milliseconds, or <paramref name="nowMs"/> while it runs.</summary>
    public long EndMsOr(long nowMs) => EndedAt?.ToUnixTimeMilliseconds() ?? nowMs;

    /// <summary>Whole seconds the timer ran, pauses removed (a running sleep counts until now).</summary>
    public long EffectiveSeconds(long nowMs) =>
        PauseMath.EffectiveSeconds(StartMs, EndedAt?.ToUnixTimeMilliseconds(), PausedSeconds, PausedAt?.ToUnixTimeMilliseconds(), nowMs);

    /// <summary>Effective milliseconds inside [<paramref name="fromMs"/>, <paramref name="toMs"/>].</summary>
    public double EffectiveMsInWindow(long fromMs, long toMs, long nowMs) =>
        PauseMath.EffectiveMsInWindow(StartMs, EndedAt?.ToUnixTimeMilliseconds(), PausedSeconds, PausedAt?.ToUnixTimeMilliseconds(), fromMs, toMs, nowMs);
}
