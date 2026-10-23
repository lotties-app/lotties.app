namespace Lotties.Domain.Clinical;

/// <summary>
/// The timer pause arithmetic of the parents' app (<c>pauseMath.ts</c>), on epoch milliseconds: the effective length of an
/// event is its wall length minus the finished pauses and, for a running event, the pause that is open now. Whole
/// seconds, never negative. Pure; instants only, so a midnight or a daylight saving change needs no special handling.
/// </summary>
public static class PauseMath
{
    private const long MillisecondsPerSecond = 1000;

    /// <summary><c>(end or now) - start</c> in whole seconds, never negative; pauses not removed.</summary>
    public static long WallSeconds(long startMs, long? endMs, long nowMs) =>
        Math.Max(0, ((endMs ?? nowMs) - startMs) / MillisecondsPerSecond);

    /// <summary>Seconds the open pause has lasted at <paramref name="nowMs"/>; zero for a finished event or one that is not paused.</summary>
    public static long CurrentPauseSeconds(long? endMs, long? pausedAtMs, long nowMs) =>
        endMs is not null || pausedAtMs is null ? 0 : Math.Max(0, (nowMs - pausedAtMs.Value) / MillisecondsPerSecond);

    /// <summary>
    /// Seconds the timer actually ran: <c>(end or now - start) - paused_seconds - (the open pause so far)</c>. A finished
    /// event ignores a stray open pause.
    /// </summary>
    public static long EffectiveSeconds(long startMs, long? endMs, long pausedSeconds, long? pausedAtMs, long nowMs) =>
        Math.Max(0, WallSeconds(startMs, endMs, nowMs) - pausedSeconds - CurrentPauseSeconds(endMs, pausedAtMs, nowMs));

    /// <summary>
    /// Effective milliseconds inside [<paramref name="fromMs"/>, <paramref name="toMs"/>] (a local day, say): the clipped
    /// length minus the pauses, spread evenly over the event (pause positions are not stored). Exact for events inside the window.
    /// </summary>
    public static double EffectiveMsInWindow(long startMs, long? endMs, long pausedSeconds, long? pausedAtMs, long fromMs, long toMs, long nowMs)
    {
        var end = endMs ?? nowMs;
        var wall = Math.Max(0, end - startMs);
        var clipped = Math.Max(0, Math.Min(end, toMs) - Math.Max(startMs, fromMs));
        if (wall == 0 || clipped == 0)
        {
            return 0;
        }

        var effective = (double)EffectiveSeconds(startMs, endMs, pausedSeconds, pausedAtMs, nowMs) * MillisecondsPerSecond;
        return ClinicalStatistics.RoundHalfUp(effective * clipped / wall);
    }
}
