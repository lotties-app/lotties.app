using Lotties.Application.Notifications.Dispatching;
using Lotties.Infrastructure.Push;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Notifications;

/// <summary>
/// The push scheduler host (design section 7): a <see cref="PeriodicTimer"/> every <c>Push:TickSeconds</c> on the
/// injected <see cref="TimeProvider"/>, first tick at start. Not started when push is not configured or
/// <c>Push:SchedulerEnabled</c> is false. A failing tick is logged and the next one runs as usual.
/// </summary>
public sealed class PushSchedulerService : BackgroundService
{
    private readonly PushOptions _options;
    private readonly INotificationTick _tick;
    private readonly TimeProvider _time;
    private readonly ILogger<PushSchedulerService> _logger;

    public PushSchedulerService(IOptions<PushOptions> options, INotificationTick tick, TimeProvider time, ILogger<PushSchedulerService> logger)
    {
        ArgumentNullException.ThrowIfNull(options);
        _options = options.Value;
        _tick = tick ?? throw new ArgumentNullException(nameof(tick));
        _time = time ?? throw new ArgumentNullException(nameof(time));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <summary>Whether the options let the scheduler run (push configured and the scheduler enabled).</summary>
    public static bool ShouldRun(PushOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return options.IsEnabled && options.SchedulerEnabled;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!ShouldRun(_options))
        {
            _logger.LogInformation("Push scheduler not started (push not configured or Push:SchedulerEnabled is false)");
            return;
        }

        _logger.LogInformation("Push scheduler started: tick every {TickSeconds} s as {HolderId}", _options.TickSeconds, _tick.HolderId);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(_options.TickSeconds), _time);
        try
        {
            do
            {
                await RunTickAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            _logger.LogInformation("Push scheduler stopped");
        }
    }

    private async Task RunTickAsync(CancellationToken stoppingToken)
    {
        try
        {
            await _tick.RunOnceAsync(_time.GetUtcNow(), stoppingToken);
        }
        catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
        {
            _logger.LogError(exception, "Push scheduler tick failed; the next tick retries");
        }
    }
}
