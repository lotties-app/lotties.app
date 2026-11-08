namespace Lotties.Domain.Stores;

/// <summary>The phase of a store's circuit breaker at an instant.</summary>
public enum StoreCircuitPhase
{
    /// <summary>Requests reach the store; consecutive connection failures are counted.</summary>
    Closed,

    /// <summary>Requests are answered at once with the last failure, without touching the store, until the window ends.</summary>
    Open,

    /// <summary>The window ended: one request at a time (the probe) may try the store; its outcome closes or reopens the breaker.</summary>
    HalfOpen,
}

/// <summary>
/// How a store's circuit breaker reacts (docs/design/47-bring-your-own-database.md section 5): it opens after
/// <see cref="FailureThreshold"/> consecutive connection failures, for a window from <see cref="OpenBackoff"/> (exponential per
/// reopening, with jitter), and a probe that has not reported within <see cref="ProbeLease"/> lets another request probe.
/// </summary>
public sealed record StoreCircuitPolicy
{
    public StoreCircuitPolicy(int failureThreshold, StoreBackoff openBackoff, TimeSpan probeLease)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(failureThreshold, 1);
        ArgumentNullException.ThrowIfNull(openBackoff);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(probeLease, TimeSpan.Zero);
        FailureThreshold = failureThreshold;
        OpenBackoff = openBackoff;
        ProbeLease = probeLease;
    }

    public int FailureThreshold { get; }

    public StoreBackoff OpenBackoff { get; }

    public TimeSpan ProbeLease { get; }
}

/// <summary>Whether a request may use the store now and, if not, for how long the answer stays the same.</summary>
public sealed record StoreCircuitAdmission(StoreCircuit Next, bool Allowed, bool IsProbe, TimeSpan RetryAfter, StoreFailureClass Failure)
{
    /// <summary>A request that may go on (as a probe when <paramref name="isProbe"/>).</summary>
    public static StoreCircuitAdmission Allow(StoreCircuit next, bool isProbe) => new(next, true, isProbe, TimeSpan.Zero, next.LastFailure);

    /// <summary>A request answered at once with <paramref name="circuit"/>'s last failure.</summary>
    public static StoreCircuitAdmission Reject(StoreCircuit circuit, TimeSpan retryAfter) => new(circuit, false, false, retryAfter, circuit.LastFailure);
}

/// <summary>
/// The circuit breaker state of one store (docs/design/47-bring-your-own-database.md section 5, task T8). Immutable and pure: every
/// transition takes the instant (and the jitter draw) and returns the next state, so the per-process registry can swap states
/// atomically and the tests need no clock. <see cref="Admit"/> is the request's gate (it may start a probe); <see cref="Check"/> is
/// the same gate without a transition, for the connection layer of a request that was already admitted.
/// </summary>
public sealed record StoreCircuit
{
    private StoreCircuit(int consecutiveFailures, int openings, DateTimeOffset? openUntil, DateTimeOffset? probeStartedAt, StoreFailureClass lastFailure)
    {
        ConsecutiveFailures = consecutiveFailures;
        Openings = openings;
        OpenUntil = openUntil;
        ProbeStartedAt = probeStartedAt;
        LastFailure = lastFailure;
    }

    /// <summary>A breaker that never failed.</summary>
    public static StoreCircuit Closed { get; } = new(0, 0, null, null, StoreFailureClass.Unavailable);

    /// <summary>Connection failures in a row while closed.</summary>
    public int ConsecutiveFailures { get; }

    /// <summary>How many times the breaker opened in a row without a success in between (the backoff exponent).</summary>
    public int Openings { get; }

    /// <summary>The end of the open window, or <c>null</c> while closed.</summary>
    public DateTimeOffset? OpenUntil { get; }

    /// <summary>When the running probe was let through, if one runs.</summary>
    public DateTimeOffset? ProbeStartedAt { get; }

    /// <summary>The class of the last failure: what a rejected request is told.</summary>
    public StoreFailureClass LastFailure { get; }

    public StoreCircuitPhase PhaseAt(DateTimeOffset now) => OpenUntil switch
    {
        null => StoreCircuitPhase.Closed,
        { } until when now < until => StoreCircuitPhase.Open,
        _ => StoreCircuitPhase.HalfOpen,
    };

    /// <summary>The request's gate: closed lets it through, open rejects it, half-open lets one probe through per lease.</summary>
    public StoreCircuitAdmission Admit(DateTimeOffset now, StoreCircuitPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);
        return PhaseAt(now) switch
        {
            StoreCircuitPhase.Closed => StoreCircuitAdmission.Allow(this, isProbe: false),
            StoreCircuitPhase.Open => StoreCircuitAdmission.Reject(this, OpenUntil!.Value - now),
            _ => AdmitProbe(now, policy),
        };
    }

    /// <summary>The gate without a transition: only an open window rejects (a half-open breaker's probe is already on its way).</summary>
    public StoreCircuitAdmission Check(DateTimeOffset now) =>
        PhaseAt(now) == StoreCircuitPhase.Open
            ? StoreCircuitAdmission.Reject(this, OpenUntil!.Value - now)
            : StoreCircuitAdmission.Allow(this, isProbe: false);

    /// <summary>
    /// A connection failure of class <paramref name="failure"/>: closed counts it and opens at the threshold; half-open (a failed probe)
    /// reopens with a longer window; open keeps its window. <paramref name="random"/> in [0, 1) draws the jitter.
    /// </summary>
    public StoreCircuit RecordFailure(StoreFailureClass failure, DateTimeOffset now, double random, StoreCircuitPolicy policy)
    {
        ArgumentNullException.ThrowIfNull(policy);
        return PhaseAt(now) switch
        {
            StoreCircuitPhase.Closed when ConsecutiveFailures + 1 >= policy.FailureThreshold => OpenFor(1, failure, now, random, policy),
            StoreCircuitPhase.Closed => new StoreCircuit(ConsecutiveFailures + 1, 0, null, null, failure),
            StoreCircuitPhase.Open => new StoreCircuit(ConsecutiveFailures, Openings, OpenUntil, ProbeStartedAt, failure),
            _ => OpenFor(Openings + 1, failure, now, random, policy),
        };
    }

    /// <summary>The store answered: closed forgets its failures, half-open closes; an open window stays (that request was admitted before it opened).</summary>
    public StoreCircuit RecordSuccess(DateTimeOffset now) => PhaseAt(now) switch
    {
        StoreCircuitPhase.Open => this,
        _ when ConsecutiveFailures == 0 && OpenUntil is null => this,
        _ => Closed,
    };

    private StoreCircuitAdmission AdmitProbe(DateTimeOffset now, StoreCircuitPolicy policy)
    {
        if (ProbeStartedAt is { } started && now < started + policy.ProbeLease)
        {
            return StoreCircuitAdmission.Reject(this, started + policy.ProbeLease - now);
        }

        return StoreCircuitAdmission.Allow(new StoreCircuit(ConsecutiveFailures, Openings, OpenUntil, now, LastFailure), isProbe: true);
    }

    private static StoreCircuit OpenFor(int openings, StoreFailureClass failure, DateTimeOffset now, double random, StoreCircuitPolicy policy) =>
        new(0, openings, now + policy.OpenBackoff.DelayFor(openings, random), null, failure);
}
