using System.Diagnostics.Metrics;
using Lotties.Domain.Notifications;

namespace Lotties.Application.Notifications.Dispatching;

/// <summary>
/// The <c>Lotties.Push</c> meter (docs/design/09-push-notifications.md section 18), readable with
/// <c>dotnet-counters</c> without an exporter. Tags carry codes and HTTP statuses only: never ids, endpoints or names.
/// </summary>
public sealed class PushMetrics : IDisposable
{
    public const string MeterName = "Lotties.Push";

    private readonly Meter _meter;
    private readonly Counter<long> _planned;
    private readonly Counter<long> _sent;
    private readonly Counter<long> _failed;
    private readonly Counter<long> _gone;
    private readonly Counter<long> _skipped;
    private readonly Counter<long> _actions;
    private readonly Histogram<double> _tickDuration;
    private readonly Histogram<double> _sendDuration;
    private int _activeSubscriptions;

    public PushMetrics()
    {
        _meter = new Meter(MeterName);
        _planned = _meter.CreateCounter<long>("push.planned", description: "Notifications planned, by kind.");
        _sent = _meter.CreateCounter<long>("push.sent", description: "Deliveries accepted by a push service, by kind.");
        _failed = _meter.CreateCounter<long>("push.failed", description: "Failed send attempts, by kind and push-service status.");
        _gone = _meter.CreateCounter<long>("push.gone", description: "Subscriptions the push service reported gone (404/410).");
        _skipped = _meter.CreateCounter<long>("push.skipped", description: "Due reminders held back, by reason.");
        _actions = _meter.CreateCounter<long>("push.actions", description: "Snooze and dismiss actions, by action.");
        _tickDuration = _meter.CreateHistogram<double>("push.tick.duration", "s", "Duration of one scheduler tick.");
        _sendDuration = _meter.CreateHistogram<double>("push.send.duration", "s", "Duration of one push-service request.");
        _meter.CreateObservableGauge("push.subscriptions.active", () => Volatile.Read(ref _activeSubscriptions), description: "Active push subscriptions (updated every tick).");
    }

    public void Planned(NotificationKind kind) => _planned.Add(1, KindTag(kind));

    public void Sent(NotificationKind kind) => _sent.Add(1, KindTag(kind));

    /// <param name="status">The push service's HTTP status, or <c>null</c> when no answer arrived or nothing was sent.</param>
    public void Failed(NotificationKind kind, int? status) =>
        _failed.Add(1, KindTag(kind), new KeyValuePair<string, object?>("status", status?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? "none"));

    public void Gone() => _gone.Add(1);

    public void Skipped(NotificationSkipReason reason) => _skipped.Add(1, new KeyValuePair<string, object?>("reason", NotificationCodes.Of(reason)));

    public void Action(NotificationActionKind action) => _actions.Add(1, new KeyValuePair<string, object?>("action", NotificationCodes.Of(action)));

    public void TickDuration(TimeSpan elapsed) => _tickDuration.Record(elapsed.TotalSeconds);

    public void SendDuration(TimeSpan elapsed) => _sendDuration.Record(elapsed.TotalSeconds);

    public void ActiveSubscriptions(int count) => Volatile.Write(ref _activeSubscriptions, count);

    public void Dispose() => _meter.Dispose();

    private static KeyValuePair<string, object?> KindTag(NotificationKind kind) => new("kind", NotificationCodes.Of(kind));
}
