using System.Threading.RateLimiting;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Limits;

/// <summary>
/// The per-user limit of assistant commands (<see cref="RequestLimitsOptions.AssistantPermitsPerMinute"/>, fixed one-minute
/// windows like <see cref="UserRateLimits"/>). An assistant request is anonymous at the HTTP level (its user is known only
/// after the account-linking token in its body is validated), so the adapter asks this limiter itself, per <c>sub</c>,
/// after authenticating her; the global per-address limit of the middleware still applies before.
/// </summary>
internal sealed class AssistantRateLimiter : IDisposable
{
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(1);

    private readonly PartitionedRateLimiter<string> _limiter;

    public AssistantRateLimiter(IOptions<RequestLimitsOptions> options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var permits = options.Value.AssistantPermitsPerMinute;
        _limiter = PartitionedRateLimiter.Create<string, string>(subject => RateLimitPartition.GetFixedWindowLimiter(subject, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = permits,
            Window = Window,
            QueueLimit = 0,
        }));
    }

    /// <summary>Takes one permit for <paramref name="subject"/>; <c>false</c> when her window is used up.</summary>
    public bool TryAcquire(string subject)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(subject);
        using var lease = _limiter.AttemptAcquire($"assistant:{subject}");
        return lease.IsAcquired;
    }

    public void Dispose() => _limiter.Dispose();
}
