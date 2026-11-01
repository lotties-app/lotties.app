using Lotties.Api.Tests.Support;
using Lotties.Application.Notifications.Dispatching;
using Lotties.Infrastructure.Push;
using Microsoft.Extensions.Logging.Abstractions;
using Lotties.Infrastructure.Notifications;

namespace Lotties.Api.Tests.Notifications;

/// <summary>The background host around <see cref="INotificationTick"/>: when it runs, which clock it reads, and that a failing tick does not stop it.</summary>
public sealed class PushSchedulerServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 10, 21, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task ExecuteAsync_PushOffOrSchedulerDisabled_NeverTicks(bool configured, bool schedulerEnabled)
    {
        var tick = new RecordingTick();
        using var service = NewService(Options(configured, schedulerEnabled), tick);

        await service.StartAsync(CancellationToken.None);
        await service.ExecuteTask!;
        await service.StopAsync(CancellationToken.None);

        Assert.Empty(tick.Calls);
    }

    [Fact]
    public async Task ExecuteAsync_Enabled_TicksAtStartWithTheProvidersTimeAndSurvivesAFailingTick()
    {
        var tick = new RecordingTick { Failure = new InvalidOperationException("database down") };
        using var service = NewService(Options(configured: true, schedulerEnabled: true), tick);

        await service.StartAsync(CancellationToken.None);
        var first = await tick.FirstCall.Task.WaitAsync(TimeSpan.FromSeconds(10));
        await service.StopAsync(CancellationToken.None);

        Assert.Equal(Now, first);
        Assert.False(service.ExecuteTask!.IsFaulted);
    }

    private static PushSchedulerService NewService(PushOptions options, INotificationTick tick) =>
        new(Microsoft.Extensions.Options.Options.Create(options), tick, new FixedTimeProvider(Now), NullLogger<PushSchedulerService>.Instance);

    private static PushOptions Options(bool configured, bool schedulerEnabled) => new()
    {
        SchedulerEnabled = schedulerEnabled,
        TickSeconds = PushOptions.MaxTickSeconds,
        Vapid = configured ? new PushVapidOptions { PublicKey = "public", PrivateKey = "private", Subject = "mailto:ops@example.org" } : new PushVapidOptions(),
    };

    private sealed class RecordingTick : INotificationTick
    {
        public List<DateTimeOffset> Calls { get; } = [];

        public TaskCompletionSource<DateTimeOffset> FirstCall { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Exception? Failure { get; init; }

        public string HolderId => "test-holder";

        public Task<NotificationTickResult> RunOnceAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
        {
            Calls.Add(now);
            FirstCall.TrySetResult(now);
            return Failure is null ? Task.FromResult(NotificationTickResult.LeaseNotHeld) : Task.FromException<NotificationTickResult>(Failure);
        }
    }
}
