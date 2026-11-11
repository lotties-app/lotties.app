using Lotties.Application.SilentPush;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.SilentPush;

/// <summary>One pass of the silent push worker: the batches due now, then the hourly housekeeping.</summary>
public interface ISilentPushTick
{
    /// <summary>Pushes every batch due at <paramref name="now"/>; returns how many babies were pushed.</summary>
    Task<int> RunOnceAsync(DateTimeOffset now, CancellationToken cancellationToken = default);
}

/// <summary>
/// Takes the due batches from the <see cref="SilentPushQueue"/> and pushes each in its own DI scope (one unit of work per
/// baby; a failing baby is logged and the others still go). Housekeeping runs on the first pass and then at most hourly.
/// Passes are expected one at a time (the worker awaits each).
/// </summary>
internal sealed class SilentPushTickRunner(
    SilentPushQueue queue,
    ISilentPushConfiguration configuration,
    IServiceScopeFactory scopes,
    ILogger<SilentPushTickRunner> logger) : ISilentPushTick
{
    public static readonly TimeSpan HousekeepingInterval = TimeSpan.FromHours(1);

    private DateTimeOffset _nextHousekeepingAt = DateTimeOffset.MinValue;

    public async Task<int> RunOnceAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var due = queue.TakeDue(now, configuration.Timing);
        foreach (var batch in due)
        {
            await DispatchAsync(batch, now, cancellationToken);
        }

        await HousekeepIfDueAsync(now, cancellationToken);
        return due.Count;
    }

    private async Task DispatchAsync(Domain.SilentPush.BabyChangeBatch batch, DateTimeOffset now, CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<ISilentPushDispatcher>().DispatchAsync(batch, now, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Silent push for baby {BabyId} failed; its changes reach the phones at their next sync", batch.BabyId);
        }
    }

    private async Task HousekeepIfDueAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (now < _nextHousekeepingAt)
        {
            return;
        }

        _nextHousekeepingAt = now + HousekeepingInterval;
        await using var scope = scopes.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<ISilentPushDispatcher>().HousekeepAsync(now, cancellationToken);
    }
}

/// <summary>
/// The silent push host: a <see cref="PeriodicTimer"/> every <c>SilentPush:WorkerTickSeconds</c> on the injected
/// <see cref="TimeProvider"/>. Not started while silent pushes are off or <c>SilentPush:WorkerEnabled</c> is false. A failing
/// pass is logged and the next one runs as usual.
/// </summary>
public sealed class SilentPushWorker(IOptions<SilentPushOptions> options, ISilentPushTick tick, TimeProvider time, ILogger<SilentPushWorker> logger) : BackgroundService
{
    /// <summary>Whether the options let the worker run (silent pushes on and the worker enabled).</summary>
    public static bool ShouldRun(SilentPushOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        return options.Enabled && options.WorkerEnabled;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!ShouldRun(options.Value))
        {
            logger.LogInformation("Silent push worker not started (SilentPush:Enabled or SilentPush:WorkerEnabled is false)");
            return;
        }

        logger.LogInformation("Silent push worker started: every {TickSeconds} s", options.Value.WorkerTickSeconds);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.Value.WorkerTickSeconds), time);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await RunPassAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            logger.LogInformation("Silent push worker stopped");
        }
    }

    private async Task RunPassAsync(CancellationToken stoppingToken)
    {
        try
        {
            await tick.RunOnceAsync(time.GetUtcNow(), stoppingToken);
        }
        catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
        {
            logger.LogError(exception, "Silent push pass failed; the next pass retries");
        }
    }
}
