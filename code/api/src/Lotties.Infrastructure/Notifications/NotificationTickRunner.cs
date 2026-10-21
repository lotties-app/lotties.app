using System.Security.Cryptography;
using Lotties.Application.Notifications.Dispatching;
using Lotties.Domain.Notifications;
using Lotties.Infrastructure.Push;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Notifications;

/// <summary>
/// Runs one tick in its own DI scope (one unit of work per tick) as this process's lease holder. The lease lasts two
/// ticks, so a crashed holder is replaced within two ticks. Housekeeping runs on the first tick this instance plans
/// and then at most hourly. Ticks are expected one at a time (the background service awaits each).
/// </summary>
internal sealed class NotificationTickRunner : INotificationTick
{
    public static readonly TimeSpan HousekeepingInterval = TimeSpan.FromHours(1);

    private readonly IServiceScopeFactory _scopes;
    private readonly TimeSpan _leaseDuration;
    private readonly ILogger<NotificationTickRunner> _logger;
    private DateTimeOffset _nextHousekeepingAt = DateTimeOffset.MinValue;
    private bool _heldLease;

    public NotificationTickRunner(IServiceScopeFactory scopes, IOptions<PushOptions> options, ILogger<NotificationTickRunner> logger)
    {
        _scopes = scopes ?? throw new ArgumentNullException(nameof(scopes));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        ArgumentNullException.ThrowIfNull(options);
        _leaseDuration = TimeSpan.FromSeconds(options.Value.TickSeconds) * 2;
        HolderId = NewHolderId();
    }

    public string HolderId { get; }

    public async Task<NotificationTickResult> RunOnceAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        await using var scope = _scopes.CreateAsyncScope();
        var dispatcher = scope.ServiceProvider.GetRequiredService<INotificationDispatcher>();
        var result = await dispatcher.DispatchAsync(new NotificationTickRequest(now, HolderId, _leaseDuration, now >= _nextHousekeepingAt), cancellationToken);
        _nextHousekeepingAt = result.HousekeepingRan ? now + HousekeepingInterval : _nextHousekeepingAt;
        TrackLease(result.LeaseHeld);
        return result;
    }

    private void TrackLease(bool held)
    {
        if (_heldLease && !held)
        {
            _logger.LogWarning("Push scheduler lease lost to another instance; this instance stops planning until it is free");
        }

        _heldLease = held;
    }

    /// <summary>Machine, process and a random suffix, at most <see cref="JobLease.HolderMaxLength"/> characters.</summary>
    private static string NewHolderId()
    {
        var suffix = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
        var holder = $"{Environment.MachineName}:{Environment.ProcessId}:{suffix}";
        return holder.Length <= JobLease.HolderMaxLength ? holder : holder[^JobLease.HolderMaxLength..];
    }
}
