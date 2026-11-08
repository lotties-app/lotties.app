using Lotties.Domain.Stores;

namespace Lotties.Domain.Tests.Stores;

/// <summary>
/// The circuit breaker state machine of a store (docs/design/47-bring-your-own-database.md section 5, task T8): closed, open after the
/// threshold of connection failures, half-open with one probe per lease, closed again on a success, reopened for longer on a failed
/// probe. Every transition takes the instant, so no clock is needed.
/// </summary>
public sealed class StoreCircuitTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 7, 12, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan Window = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan Lease = TimeSpan.FromSeconds(10);
    private static readonly StoreCircuitPolicy Policy = new(3, new StoreBackoff(Window, TimeSpan.FromMinutes(5), 0.2), Lease);

    [Fact]
    public void Closed_LetsRequestsThroughAndCountsFailuresBelowTheThreshold()
    {
        var circuit = Fail(StoreCircuit.Closed, 2, StoreFailureClass.Timeout);

        var admission = circuit.Admit(Start, Policy);

        Assert.Equal(StoreCircuitPhase.Closed, circuit.PhaseAt(Start));
        Assert.True(admission.Allowed);
        Assert.False(admission.IsProbe);
        Assert.Equal(2, circuit.ConsecutiveFailures);
    }

    [Fact]
    public void Failures_AtTheThreshold_OpenForTheFirstWindowAndRejectWithTheLastClass()
    {
        var circuit = Fail(StoreCircuit.Closed, 3, StoreFailureClass.PausedOrUnreachable);

        var admission = circuit.Admit(Start + TimeSpan.FromSeconds(10), Policy);

        Assert.Equal(StoreCircuitPhase.Open, circuit.PhaseAt(Start));
        Assert.Equal(Start + Window, circuit.OpenUntil);
        Assert.False(admission.Allowed);
        Assert.Equal(TimeSpan.FromSeconds(20), admission.RetryAfter);
        Assert.Equal(StoreFailureClass.PausedOrUnreachable, admission.Failure);
    }

    [Fact]
    public void Success_WhileClosed_ResetsTheCount()
    {
        var circuit = Fail(StoreCircuit.Closed, 2, StoreFailureClass.Timeout).RecordSuccess(Start);

        circuit = Fail(circuit, 2, StoreFailureClass.Timeout);

        Assert.Equal(StoreCircuitPhase.Closed, circuit.PhaseAt(Start));
    }

    [Fact]
    public void Success_ThatNeverFailed_KeepsTheSameState()
    {
        Assert.Same(StoreCircuit.Closed, StoreCircuit.Closed.RecordSuccess(Start));
    }

    [Fact]
    public void Jitter_ShortensTheWindowByUpToItsFraction()
    {
        var circuit = StoreCircuit.Closed;
        for (var failure = 0; failure < 3; failure++)
        {
            circuit = circuit.RecordFailure(StoreFailureClass.Timeout, Start, 0.5, Policy);
        }

        Assert.Equal(Start + TimeSpan.FromSeconds(27), circuit.OpenUntil);
    }

    [Fact]
    public void WindowOver_LetsOneProbeThroughAndRejectsTheOthersUntilTheLeaseEnds()
    {
        var open = Fail(StoreCircuit.Closed, 3, StoreFailureClass.Timeout);
        var afterWindow = Start + Window;

        var probe = open.Admit(afterWindow, Policy);
        var second = probe.Next.Admit(afterWindow + TimeSpan.FromSeconds(4), Policy);
        var afterLease = probe.Next.Admit(afterWindow + Lease, Policy);

        Assert.Equal(StoreCircuitPhase.HalfOpen, open.PhaseAt(afterWindow));
        Assert.True(probe.Allowed);
        Assert.True(probe.IsProbe);
        Assert.False(second.Allowed);
        Assert.Equal(TimeSpan.FromSeconds(6), second.RetryAfter);
        Assert.True(afterLease is { Allowed: true, IsProbe: true });
    }

    [Fact]
    public void ProbeSucceeds_ClosesTheBreaker()
    {
        var probing = Fail(StoreCircuit.Closed, 3, StoreFailureClass.Timeout).Admit(Start + Window, Policy).Next;

        var closed = probing.RecordSuccess(Start + Window);

        Assert.Same(StoreCircuit.Closed, closed);
        Assert.True(closed.Admit(Start + Window, Policy).Allowed);
    }

    [Fact]
    public void ProbeFails_ReopensForADoubledWindow()
    {
        var afterWindow = Start + Window;
        var probing = Fail(StoreCircuit.Closed, 3, StoreFailureClass.Timeout).Admit(afterWindow, Policy).Next;

        var reopened = probing.RecordFailure(StoreFailureClass.CredentialsRejected, afterWindow, 0, Policy);

        Assert.Equal(StoreCircuitPhase.Open, reopened.PhaseAt(afterWindow));
        Assert.Equal(afterWindow + (2 * Window), reopened.OpenUntil);
        Assert.Equal(2, reopened.Openings);
        Assert.Equal(StoreFailureClass.CredentialsRejected, reopened.Admit(afterWindow, Policy).Failure);
    }

    [Fact]
    public void RepeatedFailedProbes_StopAtTheLongestWindow()
    {
        var circuit = Fail(StoreCircuit.Closed, 3, StoreFailureClass.Timeout);
        var now = Start;
        for (var probe = 0; probe < 10; probe++)
        {
            now = circuit.OpenUntil!.Value;
            circuit = circuit.Admit(now, Policy).Next.RecordFailure(StoreFailureClass.Timeout, now, 0, Policy);
        }

        Assert.Equal(now + TimeSpan.FromMinutes(5), circuit.OpenUntil);
    }

    [Fact]
    public void WhileOpen_ALateFailureOrSuccessKeepsTheWindow()
    {
        var open = Fail(StoreCircuit.Closed, 3, StoreFailureClass.Timeout);
        var inside = Start + TimeSpan.FromSeconds(5);

        var afterFailure = open.RecordFailure(StoreFailureClass.Unavailable, inside, 0, Policy);
        var afterSuccess = open.RecordSuccess(inside);

        Assert.Equal(open.OpenUntil, afterFailure.OpenUntil);
        Assert.Equal(StoreFailureClass.Unavailable, afterFailure.LastFailure);
        Assert.Same(open, afterSuccess);
    }

    [Fact]
    public void Check_RejectsOnlyDuringTheOpenWindowAndNeverStartsAProbe()
    {
        var open = Fail(StoreCircuit.Closed, 3, StoreFailureClass.Timeout);

        var inside = open.Check(Start + TimeSpan.FromSeconds(1));
        var after = open.Check(Start + Window);

        Assert.False(inside.Allowed);
        Assert.True(after.Allowed);
        Assert.Same(open, after.Next);
        Assert.Null(after.Next.ProbeStartedAt);
    }

    [Fact]
    public void Policy_RejectsInvalidValues()
    {
        var backoff = new StoreBackoff(Window, Window, 0);

        Assert.Throws<ArgumentOutOfRangeException>(() => new StoreCircuitPolicy(0, backoff, Lease));
        Assert.Throws<ArgumentOutOfRangeException>(() => new StoreCircuitPolicy(1, backoff, TimeSpan.Zero));
        Assert.Throws<ArgumentNullException>(() => new StoreCircuitPolicy(1, null!, Lease));
    }

    private static StoreCircuit Fail(StoreCircuit circuit, int times, StoreFailureClass failure)
    {
        for (var attempt = 0; attempt < times; attempt++)
        {
            circuit = circuit.RecordFailure(failure, Start, 0, Policy);
        }

        return circuit;
    }
}
