using BabyRoutine.Application.Notifications;
using BabyRoutine.Domain.Exceptions;
using BabyRoutine.Domain.Notifications;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Push;

/// <summary>
/// Snooze or dismiss of one delivered reminder, authorized by the delivery's action token only (the service worker has
/// no access token). Unknown delivery, wrong token or a request more than 12 h after the due time are all
/// <see cref="NotificationActionNotFoundException"/>; a fourth snooze is <see cref="SnoozeLimitReachedException"/>.
/// </summary>
public interface INotificationActionService
{
    Task ApplyAsync(Guid deliveryId, NotificationActionRequest request, CancellationToken cancellationToken = default);
}

internal sealed class NotificationActionService : INotificationActionService
{
    private const string SnoozeAction = "snooze";
    private const string DismissAction = "dismiss";

    private readonly INotificationDeliveryRepository _deliveries;
    private readonly INotificationActionRepository _actions;
    private readonly IPushConfiguration _configuration;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<NotificationActionService> _logger;

    public NotificationActionService(
        INotificationDeliveryRepository deliveries,
        INotificationActionRepository actions,
        IPushConfiguration configuration,
        TimeProvider timeProvider,
        ILogger<NotificationActionService> logger)
    {
        _deliveries = deliveries ?? throw new ArgumentNullException(nameof(deliveries));
        _actions = actions ?? throw new ArgumentNullException(nameof(actions));
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task ApplyAsync(Guid deliveryId, NotificationActionRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        _configuration.EnsureEnabled();
        var kind = ActionOf(request.Action);
        var now = _timeProvider.GetUtcNow();
        var delivery = await _deliveries.FindAsync(deliveryId, cancellationToken) ?? throw new NotificationActionNotFoundException(deliveryId);
        delivery.EnsureActionAllowed(request.Token, now);
        var babyId = delivery.BabyId ?? throw new NotificationActionNotFoundException(deliveryId);
        var target = new ActionTarget(delivery.UserId, babyId, delivery.BaseKey.Base);
        await (kind == NotificationActionKind.Snoozed ? SnoozeAsync(target, now, cancellationToken) : DismissAsync(target, now, cancellationToken));
        _logger.LogInformation("Delivery {DeliveryId}: user {UserId} {Action} the reminder", deliveryId, target.UserId, NotificationCodes.Of(kind));
    }

    private Task SnoozeAsync(ActionTarget target, DateTimeOffset now, CancellationToken cancellationToken) =>
        UpsertAsync(target, () => NotificationAction.Snooze(target.UserId, target.BabyId, target.BaseKey, now), action => action.Snooze(now), cancellationToken);

    private async Task DismissAsync(ActionTarget target, DateTimeOffset now, CancellationToken cancellationToken)
    {
        await UpsertAsync(target, () => NotificationAction.Dismiss(target.UserId, target.BabyId, target.BaseKey, now), action => action.Dismiss(now), cancellationToken);
        await _deliveries.CancelPendingResendsAsync(target.UserId, target.BaseKey, cancellationToken);
    }

    /// <summary>Applies the action to the user's stored one, or stores the first one (a concurrent first action is reloaded and applied to).</summary>
    private async Task UpsertAsync(ActionTarget target, Func<NotificationAction> create, Action<NotificationAction> apply, CancellationToken cancellationToken)
    {
        var existing = await _actions.FindAsync(target.UserId, target.BaseKey, cancellationToken);
        if (existing is null && await _actions.TryAddAsync(create(), cancellationToken))
        {
            return;
        }

        apply(existing ?? await FindConcurrentWinnerAsync(target, cancellationToken));
        await _actions.SaveChangesAsync(cancellationToken);
    }

    private async Task<NotificationAction> FindConcurrentWinnerAsync(ActionTarget target, CancellationToken cancellationToken) =>
        await _actions.FindAsync(target.UserId, target.BaseKey, cancellationToken)
            ?? throw new InvalidOperationException("A notification action was reported as existing but could not be loaded.");

    private static NotificationActionKind ActionOf(string? action) => action switch
    {
        SnoozeAction => NotificationActionKind.Snoozed,
        DismissAction => NotificationActionKind.Dismissed,
        _ => throw new DomainValidationException("action", $"action must be '{SnoozeAction}' or '{DismissAction}'."),
    };

    private sealed record ActionTarget(Guid UserId, Guid BabyId, NotificationKey BaseKey);
}
