namespace BabyRoutine.Application.Notifications.Dispatching;

/// <summary>
/// One scheduler tick on demand (design section 7). The background service calls it every <c>Push:TickSeconds</c>;
/// tests set <c>Push:SchedulerEnabled=false</c> and call it with their own clock.
/// </summary>
public interface INotificationTick
{
    /// <summary>The instance id this process holds the scheduler lease with.</summary>
    string HolderId { get; }

    Task<NotificationTickResult> RunOnceAsync(DateTimeOffset now, CancellationToken cancellationToken = default);
}

/// <summary>Runs the tick steps in one unit of work (resolve it from a fresh scope per tick).</summary>
public interface INotificationDispatcher
{
    Task<NotificationTickResult> DispatchAsync(NotificationTickRequest request, CancellationToken cancellationToken = default);
}

/// <summary>What a tick needs from its host: the instant, the lease holder and duration, and whether housekeeping is due.</summary>
public sealed record NotificationTickRequest(DateTimeOffset Now, string HolderId, TimeSpan LeaseDuration, bool RunHousekeeping);

/// <summary>Scheduler settings the application uses (bound from the <c>Push</c> options by the host).</summary>
/// <param name="MaxConcurrentSends">Push-service requests in flight at once.</param>
/// <param name="RetryBatchSize">Pending deliveries re-sent per tick at most.</param>
public sealed record NotificationDispatchSettings(int MaxConcurrentSends, int RetryBatchSize = 200)
{
    public static NotificationDispatchSettings Default { get; } = new(8);
}

/// <summary>Counts of one tick (no ids or content). <see cref="LeaseHeld"/> false: another instance planned; nothing else ran.</summary>
/// <param name="Retried">Pending deliveries re-sent by the retry step.</param>
/// <param name="Planned">Notifications the planner returned (per user, before fan-out to devices).</param>
/// <param name="Claimed">Delivery rows this tick claimed (one per planned notification and active subscription).</param>
/// <param name="Sent">Send attempts the push service accepted (retry step and new claims).</param>
/// <param name="Retrying">Attempts that failed retryably and wait for their next attempt.</param>
/// <param name="Failed">Deliveries that gave up (attempts exhausted, not retryable, or refused endpoint).</param>
/// <param name="Gone">Deliveries whose subscription the push service reported gone.</param>
/// <param name="Expired">Pending deliveries past their time to live.</param>
/// <param name="Cancelled">Pending deliveries withdrawn because their subscription is no longer active.</param>
public sealed record NotificationTickResult(
    bool LeaseHeld,
    int Retried,
    int Planned,
    int Claimed,
    int Sent,
    int Retrying,
    int Failed,
    int Gone,
    int Expired,
    int Cancelled,
    bool HousekeepingRan)
{
    public static NotificationTickResult LeaseNotHeld { get; } = new(false, 0, 0, 0, 0, 0, 0, 0, 0, 0, false);
}
