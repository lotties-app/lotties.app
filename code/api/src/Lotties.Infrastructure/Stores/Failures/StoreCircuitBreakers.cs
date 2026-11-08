using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores.Failures;

/// <summary>
/// The circuit breakers of the external stores, one per store id, held by the process (docs/design/47-bring-your-own-database.md
/// section 5, task T8). <see cref="StoreScope"/> admits a request before it opens a store (<see cref="Admit"/>: an open breaker answers
/// at once, without touching the network, with the class that opened it and <c>Retry-After</c>; a half-open one lets one probe
/// through); the connection layer (<see cref="StoreFailureInterceptor"/>) reports each command's outcome. The state is a few numbers
/// per store and the class of the last failure: nothing read from a store is kept here. The built-in store has no breaker.
/// </summary>
internal sealed class StoreCircuitBreakers
{
    private readonly Lock _gate = new();
    private readonly Dictionary<Guid, StoreCircuit> _circuits = [];
    private readonly StoreCircuitPolicy _policy;
    private readonly TimeProvider _time;
    private readonly ILogger<StoreCircuitBreakers> _logger;
    private readonly Func<double> _random;

    public StoreCircuitBreakers(IOptions<StoreCircuitBreakerOptions> options, TimeProvider time, ILogger<StoreCircuitBreakers> logger)
        : this(options, time, logger, Random.Shared.NextDouble)
    {
    }

    /// <summary>Test seam: <paramref name="random"/> draws the jitter (a value in [0, 1)).</summary>
    internal StoreCircuitBreakers(IOptions<StoreCircuitBreakerOptions> options, TimeProvider time, ILogger<StoreCircuitBreakers> logger, Func<double> random)
    {
        _policy = (options ?? throw new ArgumentNullException(nameof(options))).Value.Policy;
        _time = time ?? throw new ArgumentNullException(nameof(time));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        _random = random ?? throw new ArgumentNullException(nameof(random));
    }

    /// <summary>The request's gate before it opens the store; throws the store's last failure while the breaker is open.</summary>
    public void Admit(Guid storeId) => ThrowIfRejected(Transition(storeId, (circuit, now) => circuit.Admit(now, _policy)));

    /// <summary>The gate of a new physical connection of an admitted request: rejects only during an open window, changes nothing.</summary>
    public void Check(Guid storeId) => ThrowIfRejected(Transition(storeId, (circuit, now) => circuit.Check(now)));

    /// <summary>A failure of the store; only a connection failure (<see cref="StoreFailureCodes.CountsAsConnectionFailure"/>) counts.</summary>
    public void RecordFailure(Guid storeId, StoreFailureClass failure)
    {
        if (!StoreFailureCodes.CountsAsConnectionFailure(failure))
        {
            return;
        }

        var (before, after) = Update(storeId, (circuit, now) => circuit.RecordFailure(failure, now, _random(), _policy));
        if (after.OpenUntil is { } until && after.OpenUntil != before.OpenUntil)
        {
            _logger.LogWarning("Circuit breaker of store {StoreId} opened for {Seconds} s after {StoreFailure} (opening {Openings})", storeId, (long)Math.Ceiling((until - _time.GetUtcNow()).TotalSeconds), failure, after.Openings);
        }
    }

    /// <summary>The store answered a command.</summary>
    public void RecordSuccess(Guid storeId)
    {
        var (before, after) = Update(storeId, (circuit, now) => circuit.RecordSuccess(now));
        if (before.OpenUntil is not null && after.OpenUntil is null)
        {
            _logger.LogInformation("Circuit breaker of store {StoreId} closed", storeId);
        }
    }

    /// <summary>The breaker's phase now (closed for a store never seen).</summary>
    public StoreCircuitPhase PhaseOf(Guid storeId)
    {
        lock (_gate)
        {
            return CircuitOf(storeId).PhaseAt(_time.GetUtcNow());
        }
    }

    /// <summary>Forgets the store's breaker (its descriptor was replaced or removed).</summary>
    public void Forget(Guid storeId)
    {
        lock (_gate)
        {
            _circuits.Remove(storeId);
        }
    }

    private StoreCircuitAdmission Transition(Guid storeId, Func<StoreCircuit, DateTimeOffset, StoreCircuitAdmission> gate)
    {
        lock (_gate)
        {
            var admission = gate(CircuitOf(storeId), _time.GetUtcNow());
            Store(storeId, admission.Next);
            return admission;
        }
    }

    private (StoreCircuit Before, StoreCircuit After) Update(Guid storeId, Func<StoreCircuit, DateTimeOffset, StoreCircuit> transition)
    {
        lock (_gate)
        {
            var before = CircuitOf(storeId);
            var after = transition(before, _time.GetUtcNow());
            Store(storeId, after);
            return (before, after);
        }
    }

    private StoreCircuit CircuitOf(Guid storeId) => _circuits.GetValueOrDefault(storeId) ?? StoreCircuit.Closed;

    private void Store(Guid storeId, StoreCircuit circuit)
    {
        if (ReferenceEquals(circuit, StoreCircuit.Closed))
        {
            _circuits.Remove(storeId);
            return;
        }

        _circuits[storeId] = circuit;
    }

    private static void ThrowIfRejected(StoreCircuitAdmission admission)
    {
        if (!admission.Allowed)
        {
            throw StoreFailureException.Of(admission.Failure, admission.RetryAfter);
        }
    }
}
