using System.Collections.Concurrent;
using System.Threading.Channels;
using Lotties.Application.Stores;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Stores.Moves;

/// <summary>The moves this process started and has not picked up yet (unbounded; a lost item is found again by the sweep).</summary>
internal sealed class StoreMoveQueue : IStoreMoveQueue
{
    private readonly Channel<Guid> _channel = Channel.CreateUnbounded<Guid>(new UnboundedChannelOptions { SingleReader = true });

    public ChannelReader<Guid> Reader => _channel.Reader;

    public void Enqueue(Guid babyId) => _channel.Writer.TryWrite(babyId);
}

/// <summary>
/// The move worker of this process (docs/design/47-bring-your-own-database.md section 6, task T7; registered only while
/// <c>Stores:Enabled</c> is on). Two loops: the moves this process just started, one at a time, and a sweep every
/// <see cref="StoreMoveOptions.SweepSeconds"/> (the first one interval after start) for moves whose worker stopped, old copies whose undo window is
/// over and leftovers of failed moves, across every API instance (the row's lease keeps two instances off the same move). Each baby is
/// worked on in its own DI scope and never twice at once in this process. A failing run is logged with its exception type only and
/// retried by a later sweep.
/// </summary>
internal sealed class StoreMoveWorker(
    StoreMoveQueue queue,
    IServiceScopeFactory scopes,
    StoreMoveOptions options,
    TimeProvider time,
    ILogger<StoreMoveWorker> logger) : BackgroundService
{
    /// <summary>Most moves one sweep works on.</summary>
    public const int SweepBatch = 50;

    private readonly ConcurrentDictionary<Guid, byte> _running = new();

    /// <summary>One sweep: lists the moves with work due and does it, one baby after the other (exposed for tests).</summary>
    public async Task SweepOnceAsync(CancellationToken cancellationToken)
    {
        foreach (var babyId in await DueAsync(cancellationToken))
        {
            await RunAsync(babyId, (runner, token) => runner.ProcessDueAsync(babyId, token), cancellationToken);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.WhenAll(ProcessQueueAsync(stoppingToken), SweepAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            logger.LogInformation("Data store move worker stopped");
        }
    }

    private async Task ProcessQueueAsync(CancellationToken stoppingToken)
    {
        await foreach (var babyId in queue.Reader.ReadAllAsync(stoppingToken))
        {
            await RunAsync(babyId, (runner, token) => runner.RunStartedAsync(babyId, token), stoppingToken);
        }
    }

    private async Task SweepAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(options.Sweep, time);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await SweepSafelyAsync(stoppingToken);
        }
    }

    private async Task SweepSafelyAsync(CancellationToken stoppingToken)
    {
        try
        {
            await SweepOnceAsync(stoppingToken);
        }
        catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
        {
            logger.LogError("A data store move sweep failed ({ExceptionType}); the next sweep retries", exception.GetType().Name);
        }
    }

    private async Task<IReadOnlyList<Guid>> DueAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var moves = scope.ServiceProvider.GetRequiredService<Domain.Stores.IDataStoreMoveRepository>();
        return await moves.ListDueAsync(time.GetUtcNow(), SweepBatch, cancellationToken);
    }

    private async Task RunAsync(Guid babyId, Func<IDataStoreMoveRunner, CancellationToken, Task> work, CancellationToken cancellationToken)
    {
        if (!_running.TryAdd(babyId, 0))
        {
            return;
        }

        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await work(scope.ServiceProvider.GetRequiredService<IDataStoreMoveRunner>(), cancellationToken);
        }
        catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogError("A data store move run failed ({ExceptionType}); a later sweep retries", exception.GetType().Name);
        }
        finally
        {
            _running.TryRemove(babyId, out _);
        }
    }
}
