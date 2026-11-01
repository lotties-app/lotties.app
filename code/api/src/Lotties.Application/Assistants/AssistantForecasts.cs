using Lotties.Domain.Assistants;
using Lotties.Domain.Clinical;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Application.Assistants;

/// <summary>
/// The "next ..." answers (docs/design/32-assistants.md): the next nap window, feed and diaper change, read from the same pure
/// Domain predictions the web's Now screen shows (<see cref="PredictionEngine"/>, <see cref="DiaperPredictions"/>), over the
/// same history window as <c>GET /predictions</c>. Nothing is guessed: with no prediction the answer says so. The nap window
/// follows the Now screen's rules (<c>napPrediction</c>): shown only while the baby is awake, and not when it is stale (its
/// window ended more than 2 hours ago, or no sleep was logged in the last 24 hours). Facts and estimates only, never advice.
/// </summary>
internal sealed class AssistantForecasts(IPredictionHistoryRepository history, IClinicalEventRepository clinicalEvents, PredictionOptions options)
{
    private const string SleepKey = "sleep";
    private const int RecentTake = 100;

    private static readonly TimeSpan SleepLookback = TimeSpan.FromDays(30);
    private static readonly TimeSpan StaleWindow = TimeSpan.FromHours(2);
    private static readonly TimeSpan StaleLastSleep = TimeSpan.FromDays(1);

    public async Task<AssistantResult> NextNapWindowAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var state = AssistantSleepState.Of(await SleepEventsAsync(subject, cancellationToken), subject.Now);
        if (state.Phase == AssistantSleepPhase.Asleep)
        {
            return await AsleepAsync(subject, state, cancellationToken);
        }

        var set = await PredictAsync(subject, cancellationToken);
        var sleep = set?.Predictions.FirstOrDefault(prediction => prediction.TypeKey == options.AwakeWindowTypeKey);
        return IsUsableNap(sleep, state, subject.Now)
            ? subject.Result(AssistantResultCode.NextNapWindow) with { Estimate = WindowOf(sleep!.NextStart) }
            : subject.Result(AssistantResultCode.NoNapPrediction);
    }

    public async Task<AssistantResult> NextFeedAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var set = await PredictAsync(subject, cancellationToken);
        var feeding = set?.Predictions.FirstOrDefault(prediction => prediction.TypeKey == BuiltInEventTypes.Feeding.Key);
        return feeding is null
            ? subject.Result(AssistantResultCode.NoNextFeed)
            : subject.Result(AssistantResultCode.NextFeed) with { Estimate = WindowOf(feeding.NextStart) };
    }

    public async Task<AssistantResult> NextDiaperAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var stored = await LoadAsync(subject, cancellationToken);
        var prediction = stored is null ? DiaperPrediction.None : DiaperPredictions.Predict(stored.Events, subject.Now);
        var wet = prediction.WetExpectation();
        var dirty = prediction.DirtyExpectation(subject.Now);
        return wet is null && dirty is null
            ? subject.Result(AssistantResultCode.NoNextDiaper)
            : subject.Result(AssistantResultCode.NextDiaper) with { WetEstimate = WindowOf(wet?.Window), DirtyEstimate = WindowOf(dirty?.Window) };
    }

    /// <summary>The Now screen's rule: a prediction exists, its window did not end more than 2 hours ago, and a sleep was logged in the last 24 hours.</summary>
    private static bool IsUsableNap(Prediction? sleep, AssistantSleepState state, DateTimeOffset now) =>
        sleep is not null
        && state.LastSleepEventAt is { } lastSleep
        && now - lastSleep <= StaleLastSleep
        && now - sleep.NextStart.Latest <= StaleWindow;

    /// <summary>
    /// Asleep: the expected wake-up only when the prediction has it (a sleep in progress is measured to its expected end,
    /// never earlier than now, <see cref="PredictionReason.AssumesEventInProgressEnds"/>); otherwise only that she sleeps.
    /// </summary>
    private async Task<AssistantResult> AsleepAsync(AssistantSubject subject, AssistantSleepState state, CancellationToken cancellationToken)
    {
        var set = await PredictAsync(subject, cancellationToken);
        var sleep = set?.Predictions.FirstOrDefault(prediction => prediction.TypeKey == options.AwakeWindowTypeKey);
        var wakesAt = sleep is { Reason.AssumesEventInProgressEnds: true } && sleep.AnchorAt > subject.Now ? sleep.AnchorAt : (DateTimeOffset?)null;
        return subject.Result(AssistantResultCode.NapWindowAsleep) with { At = state.Since, EndedAt = wakesAt };
    }

    private async Task<PredictionSet?> PredictAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var stored = await LoadAsync(subject, cancellationToken);
        return stored is null ? null : PredictionEngine.Predict(stored.Events, new PredictionContext(stored.BirthDate, subject.LocalNow), options);
    }

    private Task<PredictionHistory?> LoadAsync(AssistantSubject subject, CancellationToken cancellationToken) =>
        history.LoadAsync(subject.Baby.Id, subject.Now - options.LookBack, cancellationToken);

    private async Task<IReadOnlyList<Event>> SleepEventsAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var newest = await clinicalEvents.ListNewestByTypesAsync(subject.Baby.Id, [SleepKey], subject.Now - SleepLookback, subject.Now + Event.MaxClientClockSkew, RecentTake, cancellationToken);
        return newest.Select(typed => typed.Event).ToArray();
    }

    private static AssistantTimeWindow? WindowOf(NextStartWindow? window) =>
        window is null ? null : new AssistantTimeWindow(window.Earliest.ToUniversalTime(), window.Expected.ToUniversalTime(), window.Latest.ToUniversalTime());
}
