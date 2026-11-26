using Lotties.Application.Predictions;
using Lotties.Application.Stores;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Predictions;
using Lotties.Domain.Stores;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Lotties.Api.Tests.Application;

/// <summary>
/// The outcomes of a predictions answer are recorded after the answer, in a DI scope of their own: the request's scope (its database
/// context and store scope) may already be disposed when the background work runs, and a failure is only logged.
/// </summary>
public sealed class PredictionOutcomeRecorderTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly DateTimeOffset Anchor = new(2026, 1, 10, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task RecordAfterResponse_RequestScopeAlreadyDisposed_RecordsEveryPredictionInItsOwnScope()
    {
        var log = new RecordingLog();
        using var provider = Services(log, enterFails: false);
        var request = provider.CreateScope();
        var requestOutcomes = (FakeOutcomes)request.ServiceProvider.GetRequiredService<IPredictionOutcomeResolutionService>();
        var recorder = request.ServiceProvider.GetRequiredService<IPredictionOutcomeRecorder>();
        var gate = new TaskCompletionSource();
        log.Gate = gate.Task;

        var work = recorder.RecordAfterResponseAsync(BabyId, [PredictionOf("sleep"), PredictionOf("feeding")], "engine-test");
        request.Dispose();
        gate.SetResult();
        await work;

        Assert.True(requestOutcomes.Disposed);
        Assert.Empty(requestOutcomes.Recorded);
        var used = Assert.Single(log.Scopes, scope => !ReferenceEquals(scope.Outcomes, requestOutcomes));
        Assert.Equal([BabyId], used.Store.Entered);
        Assert.True(used.Store.EnteredBeforeFirstRecord);
        Assert.Equal(["sleep", "feeding"], used.Outcomes.Recorded.Select(item => item.TypeKey));
        Assert.All(used.Outcomes.Recorded, item => Assert.Equal((BabyId, "engine-test"), (item.BabyId, item.EngineVersion)));
        Assert.True(used.Outcomes.Disposed);
        Assert.Empty(log.Errors);
    }

    [Fact]
    public async Task RecordAfterResponse_StoreCannotBeEntered_LogsAndRecordsNothing()
    {
        var log = new RecordingLog();
        using var provider = Services(log, enterFails: true);
        var recorder = provider.GetRequiredService<IPredictionOutcomeRecorder>();

        await recorder.RecordAfterResponseAsync(BabyId, [PredictionOf("sleep")], "engine-test");

        Assert.Empty(log.Scopes);
        Assert.IsType<StoreUnavailableException>(Assert.Single(log.Errors));
    }

    [Fact]
    public async Task RecordAfterResponse_NoPredictions_OpensNoScope()
    {
        var log = new RecordingLog();
        using var provider = Services(log, enterFails: false);

        await provider.GetRequiredService<IPredictionOutcomeRecorder>().RecordAfterResponseAsync(BabyId, [], "engine-test");

        Assert.Empty(log.Scopes);
    }

    private static ServiceProvider Services(RecordingLog log, bool enterFails)
    {
        var services = new ServiceCollection();
        services.AddSingleton(log);
        services.AddSingleton<ILoggerFactory>(new RecordingLoggerFactory(log));
        services.AddSingleton(typeof(ILogger<>), typeof(Logger<>));
        services.AddScoped(_ => new FakeStoreScope(enterFails));
        services.AddScoped<IStoreScope>(provider => provider.GetRequiredService<FakeStoreScope>());
        services.AddScoped<IPredictionOutcomeResolutionService>(provider =>
        {
            var outcomes = new FakeOutcomes(provider.GetRequiredService<FakeStoreScope>(), log);
            log.Scopes.Add((provider.GetRequiredService<FakeStoreScope>(), outcomes));
            return outcomes;
        });
        services.AddSingleton<IPredictionOutcomeRecorder, PredictionOutcomeRecorder>();
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
    }

    private static Prediction PredictionOf(string typeKey)
    {
        var expected = Anchor.AddHours(3);
        var reason = new PredictionReason(PredictionBasis.StartInterval, TimeSpan.FromHours(3), 12, TimeSpan.FromDays(14), null, DayPhase.Day, null, false);
        return new Prediction(EventTypeKey.From(typeKey), new NextStartWindow(expected.AddMinutes(-30), expected, expected.AddMinutes(30)), null, PredictionConfidence.Medium, 12, reason, PriorOrigin.PublishedNorm, Anchor);
    }

    private sealed class RecordingLog
    {
        public List<(FakeStoreScope Store, FakeOutcomes Outcomes)> Scopes { get; } = [];

        public List<Exception> Errors { get; } = [];

        /// <summary>Holds the first recorded outcome until the test released it (so the request scope is disposed first).</summary>
        public Task Gate { get; set; } = Task.CompletedTask;
    }

    private sealed class FakeStoreScope(bool enterFails) : IStoreScope
    {
        public List<Guid> Entered { get; } = [];

        public bool EnteredBeforeFirstRecord { get; set; }

        public Task EnterAsync(Guid babyId, CancellationToken cancellationToken = default)
        {
            if (enterFails)
            {
                throw new StoreUnavailableException();
            }

            Entered.Add(babyId);
            return Task.CompletedTask;
        }

        public Task<bool> TryEnterBuiltInAsync(Guid babyId, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public StoreRoute RouteOf(Guid babyId) => throw new NotSupportedException();
    }

    private sealed class FakeOutcomes(FakeStoreScope store, RecordingLog log) : IPredictionOutcomeResolutionService, IDisposable
    {
        public List<(Guid BabyId, string TypeKey, string EngineVersion)> Recorded { get; } = [];

        public bool Disposed { get; private set; }

        public async Task RecordPredictionAsync(Prediction prediction, Guid babyId, string engineVersion, DateTimeOffset? createdAt = null, CancellationToken cancellationToken = default)
        {
            await log.Gate;
            ObjectDisposedException.ThrowIf(Disposed, this);
            if (Recorded.Count == 0)
            {
                store.EnteredBeforeFirstRecord = store.Entered.Contains(babyId);
            }

            Recorded.Add((babyId, prediction.TypeKey.Value, engineVersion));
        }

        public Task RecordFeedbackAsync(Guid babyId, string predictionId, bool accurate, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task ResolvePendingAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset actualNextStart, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task InvalidateStaleOutcomeAsync(Guid babyId, EventTypeKey typeKey, DateTimeOffset oldAnchorAt, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public void Dispose() => Disposed = true;
    }

    private sealed class RecordingLoggerFactory(RecordingLog log) : ILoggerFactory
    {
        public ILogger CreateLogger(string categoryName) => new ErrorLogger(log);

        public void AddProvider(ILoggerProvider provider)
        {
        }

        public void Dispose()
        {
        }
    }

    private sealed class ErrorLogger(RecordingLog log) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (logLevel >= LogLevel.Error && exception is not null)
            {
                lock (log)
                {
                    log.Errors.Add(exception);
                }
            }
        }
    }
}
