using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Stores.Failures;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// The per-store circuit breakers of the process (docs/design/47-bring-your-own-database.md section 5, task T8) with a fake clock:
/// a request is admitted, rejected at once with the opening class and <c>Retry-After</c>, or let through as the one probe; stores do
/// not share a breaker; only connection failures count; the options are validated.
/// </summary>
public sealed class StoreCircuitBreakersTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 7, 12, 0, 0, TimeSpan.Zero);
    private static readonly Guid StoreX = Guid.Parse("5a000000-0000-4000-8000-000000000001");
    private static readonly Guid StoreY = Guid.Parse("5a000000-0000-4000-8000-000000000002");

    private readonly FakeClock _clock = new(Start);
    private readonly StoreCircuitBreakerOptions _options = new();

    [Fact]
    public void Admit_AfterThreeConnectionFailures_ThrowsTheLastClassWithTheTimeLeftAndNeverTheOtherStore()
    {
        var breakers = Breakers();
        breakers.RecordFailure(StoreX, StoreFailureClass.Timeout);
        breakers.RecordFailure(StoreX, StoreFailureClass.Timeout);
        breakers.Admit(StoreX);
        breakers.RecordFailure(StoreX, StoreFailureClass.PausedOrUnreachable);
        _clock.Advance(TimeSpan.FromSeconds(12));

        var rejected = Assert.Throws<StorePausedOrUnreachableException>(() => breakers.Admit(StoreX));

        Assert.Equal(TimeSpan.FromSeconds(18), rejected.RetryAfter);
        Assert.Equal(StoreCircuitPhase.Open, breakers.PhaseOf(StoreX));
        breakers.Admit(StoreY);
        Assert.Equal(StoreCircuitPhase.Closed, breakers.PhaseOf(StoreY));
    }

    [Fact]
    public void RecordFailure_ClassesThatAreNotConnectionFailures_NeverOpen()
    {
        var breakers = Breakers();
        foreach (var failure in new[] { StoreFailureClass.QuotaFull, StoreFailureClass.SchemaAhead, StoreFailureClass.SchemaConflict, StoreFailureClass.RoleTooPowerful, StoreFailureClass.Migrating, StoreFailureClass.MigrationFailed })
        {
            for (var attempt = 0; attempt < 5; attempt++)
            {
                breakers.RecordFailure(StoreX, failure);
            }
        }

        breakers.Admit(StoreX);
        Assert.Equal(StoreCircuitPhase.Closed, breakers.PhaseOf(StoreX));
    }

    [Fact]
    public void HalfOpen_OneProbeAtATime_ThenASuccessCloses()
    {
        var breakers = Opened();
        _clock.Advance(TimeSpan.FromSeconds(_options.OpenSeconds));

        breakers.Admit(StoreX);
        var waiting = Assert.Throws<StoreTimeoutException>(() => breakers.Admit(StoreX));
        breakers.Check(StoreX);
        breakers.RecordSuccess(StoreX);

        Assert.Equal(TimeSpan.FromSeconds(_options.ProbeLeaseSeconds), waiting.RetryAfter);
        Assert.Equal(StoreCircuitPhase.Closed, breakers.PhaseOf(StoreX));
        breakers.Admit(StoreX);
    }

    [Fact]
    public void HalfOpen_ProbeFails_ReopensForTwiceTheWindow()
    {
        var breakers = Opened();
        _clock.Advance(TimeSpan.FromSeconds(_options.OpenSeconds));
        breakers.Admit(StoreX);

        breakers.RecordFailure(StoreX, StoreFailureClass.CredentialsRejected);

        var rejected = Assert.Throws<StoreCredentialsRejectedException>(() => breakers.Admit(StoreX));
        Assert.Equal(TimeSpan.FromSeconds(2 * _options.OpenSeconds), rejected.RetryAfter);
    }

    [Fact]
    public void Check_DuringTheOpenWindow_ThrowsWithoutStartingAProbe()
    {
        var breakers = Opened();

        Assert.Throws<StoreTimeoutException>(() => breakers.Check(StoreX));
        _clock.Advance(TimeSpan.FromSeconds(_options.OpenSeconds));
        breakers.Check(StoreX);
        breakers.Admit(StoreX);
    }

    [Fact]
    public void Forget_OpenBreaker_LetsTheNextRequestThrough()
    {
        var breakers = Opened();

        breakers.Forget(StoreX);

        breakers.Admit(StoreX);
        Assert.Equal(StoreCircuitPhase.Closed, breakers.PhaseOf(StoreX));
    }

    [Fact]
    public void Options_Defaults_AreTheDesignsAndValid()
    {
        var validator = new StoreCircuitBreakerOptionsValidator();

        Assert.Equal((3, 30, 300, 15), (_options.FailureThreshold, _options.OpenSeconds, _options.MaxOpenSeconds, _options.ProbeLeaseSeconds));
        Assert.True(validator.Validate(null, _options).Succeeded);
    }

    [Theory]
    [InlineData(0, 30, 300, 15)]
    [InlineData(21, 30, 300, 15)]
    [InlineData(3, 0, 300, 15)]
    [InlineData(3, 60, 30, 15)]
    [InlineData(3, 30, 90_000, 15)]
    [InlineData(3, 30, 300, 0)]
    [InlineData(3, 30, 300, 301)]
    public void Options_OutOfRange_FailValidation(int threshold, int openSeconds, int maxOpenSeconds, int leaseSeconds)
    {
        var options = new StoreCircuitBreakerOptions { FailureThreshold = threshold, OpenSeconds = openSeconds, MaxOpenSeconds = maxOpenSeconds, ProbeLeaseSeconds = leaseSeconds };

        Assert.True(new StoreCircuitBreakerOptionsValidator().Validate(null, options).Failed);
    }

    private StoreCircuitBreakers Breakers() =>
        new(Options.Create(_options), _clock, NullLogger<StoreCircuitBreakers>.Instance, () => 0);

    private StoreCircuitBreakers Opened()
    {
        var breakers = Breakers();
        for (var attempt = 0; attempt < _options.FailureThreshold; attempt++)
        {
            breakers.RecordFailure(StoreX, StoreFailureClass.Timeout);
        }

        return breakers;
    }

    private sealed class FakeClock(DateTimeOffset start) : TimeProvider
    {
        private DateTimeOffset _now = start;

        public void Advance(TimeSpan by) => _now += by;

        public override DateTimeOffset GetUtcNow() => _now;
    }
}
