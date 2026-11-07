using Lotties.Application.Demo;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Notifications;

/// <summary>
/// Deletes expired try-it demo accounts (docs/design/45-try-it-demo.md section 6): the first run one minute after start, then every
/// <see cref="DemoOptions.CleanupMinutes"/>. Does not run while the demo is off or the interval is not positive. A failing run is logged
/// (counts only) and the next one retries.
/// </summary>
public sealed class DemoCleanupService(DemoOptions options, IServiceScopeFactory scopes, TimeProvider time, ILogger<DemoCleanupService> logger) : BackgroundService
{
    public static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(1);

    public static bool ShouldRun(DemoOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return options.IsEnabled && options.CleanupMinutes > 0;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!ShouldRun(options))
        {
            return;
        }

        try
        {
            await Task.Delay(FirstRunDelay, time, stoppingToken);
            using var timer = new PeriodicTimer(TimeSpan.FromMinutes(options.CleanupMinutes), time);
            do
            {
                await RunOnceAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            logger.LogInformation("Demo cleanup stopped");
        }
    }

    /// <summary>One run in its own scope; exposed for tests.</summary>
    public async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IDemoCleanup>().RunOnceAsync(time.GetUtcNow(), cancellationToken);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogError(exception, "Demo cleanup run failed; the next run retries");
        }
    }
}
