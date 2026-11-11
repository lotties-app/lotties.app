using Lotties.Domain.SilentPush;

namespace Lotties.Application.SilentPush;

/// <summary>
/// Told by the write paths that a baby's records changed (docs/design/37b-widget-silent-push.md section 4.2). Cheap and
/// never throws: it only queues; the worker decides who gets a push. A no-op while silent pushes are off.
/// </summary>
public interface ISilentPushSignal
{
    /// <summary>A change of <paramref name="babyId"/>'s records written by <paramref name="userId"/> in the current request.</summary>
    void BabyChanged(Guid babyId, Guid userId);
}

internal sealed class SilentPushSignal(
    ISilentPushConfiguration configuration,
    ICurrentPushDevice currentDevice,
    SilentPushQueue queue,
    TimeProvider timeProvider) : ISilentPushSignal
{
    public void BabyChanged(Guid babyId, Guid userId)
    {
        if (!configuration.IsEnabled)
        {
            return;
        }

        queue.Add(babyId, new SilentPushOrigin(userId, currentDevice.DeviceId), timeProvider.GetUtcNow());
    }
}
