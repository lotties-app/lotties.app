namespace Lotties.Domain.Stores;

/// <summary>
/// Exponential backoff with jitter (docs/design/47-bring-your-own-database.md section 4): the wait before retry
/// <c>attempt</c> (1 for the first retry) is <see cref="Initial"/> doubled per attempt, capped at <see cref="Max"/>, then
/// shortened by up to <see cref="JitterFraction"/> of itself so that replicas and requests waiting on the same store spread out.
/// Pure: the caller passes the random draw.
/// </summary>
public sealed record StoreBackoff
{
    public StoreBackoff(TimeSpan initial, TimeSpan max, double jitterFraction)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(initial, TimeSpan.Zero);
        ArgumentOutOfRangeException.ThrowIfLessThan(max, initial);
        ArgumentOutOfRangeException.ThrowIfNegative(jitterFraction);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(jitterFraction, 1d);
        Initial = initial;
        Max = max;
        JitterFraction = jitterFraction;
    }

    public TimeSpan Initial { get; }

    public TimeSpan Max { get; }

    /// <summary>The largest share of a delay the jitter removes (0 = none, 1 = up to all of it).</summary>
    public double JitterFraction { get; }

    /// <summary>
    /// The delay before retry <paramref name="attempt"/> (1 or more) for a random draw <paramref name="random"/> in [0, 1):
    /// a draw of 0 gives the full exponential delay.
    /// </summary>
    public TimeSpan DelayFor(int attempt, double random)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(attempt, 1);
        ArgumentOutOfRangeException.ThrowIfNegative(random);
        ArgumentOutOfRangeException.ThrowIfGreaterThanOrEqual(random, 1d);
        var full = Exponential(attempt);
        return full - (full * (JitterFraction * random));
    }

    private TimeSpan Exponential(int attempt)
    {
        var doublings = Math.Min(attempt - 1, 30);
        var ticks = Initial.Ticks * Math.Pow(2, doublings);
        return ticks >= Max.Ticks ? Max : TimeSpan.FromTicks((long)ticks);
    }
}
