using Lotties.Domain.Stores;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores.Failures;

/// <summary>
/// The per-store circuit breaker (section <c>Stores:CircuitBreaker</c>, e.g. env <c>Stores__CircuitBreaker__FailureThreshold=3</c>;
/// docs/design/47-bring-your-own-database.md section 5, task T8). Defaults follow the design: open after 3 connection failures in a
/// row, a first window of 30 s doubling per reopening up to 5 minutes (minus up to 20 % jitter), one probe at a time.
/// </summary>
public sealed class StoreCircuitBreakerOptions
{
    public const string SectionName = "Stores:CircuitBreaker";

    /// <summary>Connection failures in a row that open the breaker (1 to 20).</summary>
    public int FailureThreshold { get; set; } = 3;

    /// <summary>First open window, in seconds (1 to 3600); doubles each time a probe fails.</summary>
    public int OpenSeconds { get; set; } = 30;

    /// <summary>Longest open window, in seconds (at least <see cref="OpenSeconds"/>, at most 86400).</summary>
    public int MaxOpenSeconds { get; set; } = 300;

    /// <summary>How long a half-open breaker waits for its probe's outcome before it lets another request probe, in seconds (1 to 300).</summary>
    public int ProbeLeaseSeconds { get; set; } = 15;

    /// <summary>Share of each window the jitter may remove.</summary>
    internal const double JitterFraction = 0.2;

    internal StoreCircuitPolicy Policy => new(
        FailureThreshold,
        new StoreBackoff(TimeSpan.FromSeconds(OpenSeconds), TimeSpan.FromSeconds(MaxOpenSeconds), JitterFraction),
        TimeSpan.FromSeconds(ProbeLeaseSeconds));
}

/// <summary>Fails startup on a value out of range.</summary>
internal sealed class StoreCircuitBreakerOptionsValidator : IValidateOptions<StoreCircuitBreakerOptions>
{
    public ValidateOptionsResult Validate(string? name, StoreCircuitBreakerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = new[]
        {
            Check(options.FailureThreshold is >= 1 and <= 20, nameof(options.FailureThreshold), "1 to 20"),
            Check(options.OpenSeconds is >= 1 and <= 3600, nameof(options.OpenSeconds), "1 to 3600"),
            Check(options.MaxOpenSeconds >= options.OpenSeconds && options.MaxOpenSeconds <= 86_400, nameof(options.MaxOpenSeconds), "the open window to 86400"),
            Check(options.ProbeLeaseSeconds is >= 1 and <= 300, nameof(options.ProbeLeaseSeconds), "1 to 300"),
        }.OfType<string>().ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static string? Check(bool valid, string property, string range) =>
        valid ? null : $"{StoreCircuitBreakerOptions.SectionName}:{property} must be from {range}.";
}
