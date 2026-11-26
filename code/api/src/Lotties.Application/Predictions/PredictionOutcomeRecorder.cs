using Lotties.Application.Stores;
using Lotties.Domain.Predictions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Predictions;

/// <summary>
/// Records the predictions of one answer as pending outcomes (accuracy tracking) after the answer is sent, without holding it up.
/// </summary>
public interface IPredictionOutcomeRecorder
{
    /// <summary>
    /// Starts recording <paramref name="predictions"/> of <paramref name="babyId"/> in the background and returns that work (the
    /// caller does not wait for it). It never throws: a failure is logged and nothing else happens.
    /// </summary>
    Task RecordAfterResponseAsync(Guid babyId, IReadOnlyList<Prediction> predictions, string engineVersion);
}

/// <summary>
/// The background half of the predictions answer: the work runs in its own DI scope, so its database context, store scope and
/// services live until it ends instead of being disposed with the request that started it. The request already authorized the
/// caller for the baby; the new scope enters that baby (<see cref="IStoreScope.EnterAsync"/>) so the outcomes are
/// written to the baby's own store (docs/design/47-bring-your-own-database.md section 3.6: a job enters each baby itself).
/// </summary>
internal sealed class PredictionOutcomeRecorder(IServiceScopeFactory scopes, ILogger<PredictionOutcomeRecorder> logger) : IPredictionOutcomeRecorder
{
    public Task RecordAfterResponseAsync(Guid babyId, IReadOnlyList<Prediction> predictions, string engineVersion)
    {
        ArgumentNullException.ThrowIfNull(predictions);
        if (predictions.Count == 0)
        {
            return Task.CompletedTask;
        }

        // A copy: the caller's list must not change under the background work.
        var batch = predictions.ToArray();
        return Task.Run(() => RecordAsync(babyId, batch, engineVersion));
    }

    private async Task RecordAsync(Guid babyId, IReadOnlyList<Prediction> predictions, string engineVersion)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IStoreScope>().EnterAsync(babyId, CancellationToken.None);
            var outcomes = scope.ServiceProvider.GetRequiredService<IPredictionOutcomeResolutionService>();
            foreach (var prediction in predictions)
            {
                await outcomes.RecordPredictionAsync(prediction, babyId, engineVersion, cancellationToken: CancellationToken.None);
            }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Recording prediction outcomes after the response failed for baby {BabyId}", babyId);
        }
    }
}
