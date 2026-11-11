using Lotties.Application.Consents;
using Lotties.Domain.SilentPush;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.SilentPush;

/// <summary>How many silent pushes may be in flight at once (<c>SilentPush:MaxConcurrentSends</c>).</summary>
public sealed record SilentPushDispatchSettings
{
    public SilentPushDispatchSettings(int maxConcurrentSends)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxConcurrentSends);
        MaxConcurrentSends = maxConcurrentSends;
    }

    public int MaxConcurrentSends { get; }
}

/// <summary>What one batch did: devices pushed and how many sends each outcome had.</summary>
public sealed record SilentPushDispatchResult(int Targets, IReadOnlyDictionary<SilentPushOutcome, int> Outcomes);

/// <summary>Pushes one due batch, and the hourly housekeeping (docs/design/37b-widget-silent-push.md sections 4.4 and 4.5).</summary>
public interface ISilentPushDispatcher
{
    Task<SilentPushDispatchResult> DispatchAsync(BabyChangeBatch batch, DateTimeOffset now, CancellationToken cancellationToken = default);

    Task HousekeepAsync(DateTimeOffset now, CancellationToken cancellationToken = default);
}

/// <summary>
/// The baby's members who may receive (<see cref="SilentPushRules.CanReceive"/>, never a Doctor), with a current core
/// consent, their active devices of a configured channel minus the device that made every change of the batch; one send
/// each (bounded concurrency, no retry), then each outcome recorded on its device. Logs ids and counts only.
/// </summary>
internal sealed class SilentPushDispatcher(
    ISilentPushDeviceRepository devices,
    IConsentService consents,
    ISilentPushConfiguration configuration,
    ISilentPushSender sender,
    SilentPushDispatchSettings settings,
    ILogger<SilentPushDispatcher> logger) : ISilentPushDispatcher
{
    public async Task<SilentPushDispatchResult> DispatchAsync(BabyChangeBatch batch, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(batch);
        var reachable = Reachable(batch, await devices.ListRecipientsAsync(batch.BabyId, cancellationToken));
        var targets = await WithCurrentConsentAsync(reachable, cancellationToken);
        var outcomes = await SendAllAsync(targets, cancellationToken);
        RecordOutcomes(targets, outcomes, now);
        await devices.SaveChangesAsync(cancellationToken);
        var result = new SilentPushDispatchResult(targets.Count, Count(outcomes));
        LogResult(batch, result);
        return result;
    }

    public async Task HousekeepAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var revoked = await devices.RevokeNotSeenSinceAsync(now - SilentPushRules.InactiveAfter, now, cancellationToken);
        var deleted = await devices.DeleteRevokedBeforeAsync(now - SilentPushRules.RevokedRetention, cancellationToken);
        logger.LogInformation("Silent push housekeeping: {RevokedCount} inactive devices revoked, {DeletedCount} revoked devices deleted", revoked, deleted);
    }

    private IReadOnlyList<SilentPushDevice> Reachable(BabyChangeBatch batch, IReadOnlyList<SilentPushRecipient> recipients) =>
        recipients
            .Where(recipient => SilentPushRules.CanReceive(recipient.Role) && configuration.Accepts(recipient.Device.Channel) && !batch.Skips(recipient.Device))
            .Select(recipient => recipient.Device)
            .DistinctBy(device => device.Id)
            .ToArray();

    private async Task<IReadOnlyList<SilentPushDevice>> WithCurrentConsentAsync(IReadOnlyList<SilentPushDevice> reachable, CancellationToken cancellationToken)
    {
        if (reachable.Count == 0)
        {
            return reachable;
        }

        var consented = await consents.WithCurrentCoreAsync(reachable.Select(device => device.UserId).Distinct().ToArray(), cancellationToken);
        return reachable.Where(device => consented.Contains(device.UserId)).ToArray();
    }

    private async Task<SilentPushOutcome[]> SendAllAsync(IReadOnlyList<SilentPushDevice> targets, CancellationToken cancellationToken)
    {
        var outcomes = new SilentPushOutcome[targets.Count];
        var options = new ParallelOptions { MaxDegreeOfParallelism = settings.MaxConcurrentSends, CancellationToken = cancellationToken };
        await Parallel.ForAsync(0, targets.Count, options, async (index, token) =>
            outcomes[index] = await SendOneAsync(SilentPushTarget.From(targets[index]), token));
        return outcomes;
    }

    private async Task<SilentPushOutcome> SendOneAsync(SilentPushTarget target, CancellationToken cancellationToken)
    {
        try
        {
            return await sender.SendAsync(target, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Silent push to device {DeviceId} failed unexpectedly", target.DeviceId);
            return SilentPushOutcome.Retryable;
        }
    }

    private static void RecordOutcomes(IReadOnlyList<SilentPushDevice> targets, SilentPushOutcome[] outcomes, DateTimeOffset now)
    {
        for (var index = 0; index < targets.Count; index++)
        {
            targets[index].RecordOutcome(outcomes[index], now);
        }
    }

    private static IReadOnlyDictionary<SilentPushOutcome, int> Count(SilentPushOutcome[] outcomes) =>
        outcomes.GroupBy(outcome => outcome).ToDictionary(group => group.Key, group => group.Count());

    private void LogResult(BabyChangeBatch batch, SilentPushDispatchResult result)
    {
        logger.LogInformation(
            "Silent push for baby {BabyId}: {TargetCount} devices, {SentCount} sent, {GoneCount} gone, {InvalidCount} invalid, {OtherCount} not sent",
            batch.BabyId,
            result.Targets,
            result.Outcomes.GetValueOrDefault(SilentPushOutcome.Sent),
            result.Outcomes.GetValueOrDefault(SilentPushOutcome.Gone),
            result.Outcomes.GetValueOrDefault(SilentPushOutcome.Invalid),
            result.Targets - result.Outcomes.GetValueOrDefault(SilentPushOutcome.Sent) - result.Outcomes.GetValueOrDefault(SilentPushOutcome.Gone) - result.Outcomes.GetValueOrDefault(SilentPushOutcome.Invalid));
    }
}
