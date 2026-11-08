using Lotties.Domain.Stores;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Stores.Migration;

/// <summary>
/// Timing of the store migrator (section <c>Stores:Migrator</c>, e.g. env <c>Stores__Migrator__LockWaitSeconds=5</c>;
/// docs/design/47-bring-your-own-database.md section 4). Defaults suit a request that waits for a store: it waits up to
/// <see cref="LockWaitSeconds"/> for a migration another instance runs, then answers <c>store_migrating</c>.
/// </summary>
public sealed class StoreMigratorOptions
{
    public const string SectionName = "Stores:Migrator";

    /// <summary>Longest wait for the store's migration lock (or this process's own run on the store), in seconds (1 to 60).</summary>
    public int LockWaitSeconds { get; set; } = 5;

    /// <summary>First retry delay of a busy lock, in milliseconds (10 to 5000); doubles per retry.</summary>
    public int LockRetryInitialMilliseconds { get; set; } = 50;

    /// <summary>Longest retry delay of a busy lock, in milliseconds (at least the initial one, at most 10000).</summary>
    public int LockRetryMaxMilliseconds { get; set; } = 1000;

    /// <summary>
    /// First wait after a failed run (unreachable, migration failed) before this process tries the store again, in seconds (1 to
    /// 3600); doubles per failure. Requests in between get the last error at once, without touching the store.
    /// </summary>
    public int FailureRetryInitialSeconds { get; set; } = 5;

    /// <summary>Longest wait after repeated failures, in seconds (at least the initial one, at most 86400).</summary>
    public int FailureRetryMaxSeconds { get; set; } = 300;

    /// <summary>How long a store found ready is trusted before the next request checks it again, in seconds (10 to 86400).</summary>
    public int ReadyRecheckSeconds { get; set; } = 300;

    internal StoreBackoff LockBackoff =>
        new(TimeSpan.FromMilliseconds(LockRetryInitialMilliseconds), TimeSpan.FromMilliseconds(LockRetryMaxMilliseconds), JitterFraction);

    internal StoreBackoff FailureBackoff =>
        new(TimeSpan.FromSeconds(FailureRetryInitialSeconds), TimeSpan.FromSeconds(FailureRetryMaxSeconds), JitterFraction);

    /// <summary>Share of each delay the jitter may remove.</summary>
    internal const double JitterFraction = 0.2;
}

/// <summary>Fails startup on a value out of range.</summary>
internal sealed class StoreMigratorOptionsValidator : IValidateOptions<StoreMigratorOptions>
{
    public ValidateOptionsResult Validate(string? name, StoreMigratorOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = new[]
        {
            Check(options.LockWaitSeconds is >= 1 and <= 60, nameof(options.LockWaitSeconds), "1 to 60"),
            Check(options.LockRetryInitialMilliseconds is >= 10 and <= 5000, nameof(options.LockRetryInitialMilliseconds), "10 to 5000"),
            Check(options.LockRetryMaxMilliseconds >= options.LockRetryInitialMilliseconds && options.LockRetryMaxMilliseconds <= 10_000, nameof(options.LockRetryMaxMilliseconds), "the initial delay to 10000"),
            Check(options.FailureRetryInitialSeconds is >= 1 and <= 3600, nameof(options.FailureRetryInitialSeconds), "1 to 3600"),
            Check(options.FailureRetryMaxSeconds >= options.FailureRetryInitialSeconds && options.FailureRetryMaxSeconds <= 86_400, nameof(options.FailureRetryMaxSeconds), "the initial delay to 86400"),
            Check(options.ReadyRecheckSeconds is >= 10 and <= 86_400, nameof(options.ReadyRecheckSeconds), "10 to 86400"),
        }.OfType<string>().ToArray();
        return failures.Length == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }

    private static string? Check(bool valid, string property, string range) =>
        valid ? null : $"{StoreMigratorOptions.SectionName}:{property} must be from {range}.";
}
