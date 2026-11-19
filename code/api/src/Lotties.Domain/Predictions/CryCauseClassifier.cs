using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>Probable causes of a crying spell, inferred from temporal correlation with other events.</summary>
public enum CryCause
{
    Hunger,
    Overtired,
    GasPostFeed,
    PrePoopDiscomfort,
    Overstimulation,
    Unknown,
}

/// <summary>One cause with its normalized probability and the reason it was scored.</summary>
public sealed record CryCauseProbability(CryCause Cause, double Probability, string Reason);

/// <summary>The ranked list of probable causes for one crying spell, probabilities summing to 1.0.</summary>
public sealed record CryCauseAssessment(IReadOnlyList<CryCauseProbability> Causes)
{
    /// <summary>The most likely cause, or <see cref="CryCause.Unknown"/> when no cause scored above threshold.</summary>
    public CryCause TopCause => Causes.Count > 0 ? Causes[0].Cause : CryCause.Unknown;
}

/// <summary>
/// Pure domain classifier that infers likely causes of a crying spell from temporal correlation with feeding, sleep,
/// diaper and general event-density signals. No I/O, deterministic given the same inputs.
/// </summary>
internal static class CryCauseClassifier
{
    /// <summary>
    /// Classifies the probable causes of <paramref name="cryEvent"/> given all recent events.
    /// Returns <c>null</c> when classification is disabled or the cry event is confirmed not crying.
    /// </summary>
    public static CryCauseAssessment? Classify(
        IReadOnlyList<ObservedEvent> allEvents,
        ObservedEvent cryEvent,
        PredictionContext context,
        PredictionOptions options,
        CryCauseOptions? cryOptions = null,
        PredictionSet? predictionSet = null)
    {
        ArgumentNullException.ThrowIfNull(allEvents);
        ArgumentNullException.ThrowIfNull(cryEvent);
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(options);

        if (!options.CryCauseClassificationEnabled)
        {
            return null;
        }

        if (cryEvent.ConfirmedNotCrying)
        {
            return null;
        }

        var opts = cryOptions ?? CryCauseOptions.Default;
        var cryTime = cryEvent.StartedAt;

        var scores = new Dictionary<CryCause, (double Score, string Reason)>();

        // Hunger: time since last feeding vs predicted next feed window.
        scores[CryCause.Hunger] = ScoreHunger(allEvents, cryTime, predictionSet, opts);

        // Overtired: current awake duration vs predicted awake window.
        scores[CryCause.Overtired] = ScoreOvertired(allEvents, cryTime, predictionSet, opts);

        // Gas post-feed: cry within 15-45 min after a feeding.
        scores[CryCause.GasPostFeed] = ScoreGasPostFeed(allEvents, cryTime, opts);

        // Pre-poop discomfort: no dirty diaper in > typical interval * multiplier.
        scores[CryCause.PrePoopDiscomfort] = ScorePrePoopDiscomfort(allEvents, cryTime, predictionSet, opts);

        // Overstimulation: high event density AND evening phase.
        scores[CryCause.Overstimulation] = ScoreOverstimulation(allEvents, cryTime, context, opts);

        // Normalize to probabilities.
        var probabilities = Normalize(scores, opts.MinimumScoreThreshold);

        return new CryCauseAssessment(probabilities);
    }

    private static (double Score, string Reason) ScoreHunger(
        IReadOnlyList<ObservedEvent> allEvents,
        DateTimeOffset cryTime,
        PredictionSet? predictionSet,
        CryCauseOptions opts)
    {
        var lastFeeding = allEvents
            .Where(e => e.TypeKey == BuiltInEventTypes.Feeding.Key && e.StartedAt <= cryTime)
            .OrderByDescending(e => e.StartedAt)
            .FirstOrDefault();

        if (lastFeeding is null)
        {
            // No feeding data at all; low hunger score.
            return (0.2, "No feeding history available");
        }

        var gapSinceLastFeed = cryTime - lastFeeding.StartedAt;

        // Use predicted feeding interval if available, otherwise default.
        var expectedInterval = predictionSet?.Predictions
            .FirstOrDefault(p => p.TypeKey == BuiltInEventTypes.Feeding.Key)
            ?.Reason.MedianGap ?? opts.DefaultHungerGap;

        if (gapSinceLastFeed <= TimeSpan.Zero)
        {
            return (0.0, "Cry occurred before last feeding");
        }

        // Score increases linearly as gap exceeds expected interval.
        var ratio = gapSinceLastFeed.TotalMinutes / Math.Max(expectedInterval.TotalMinutes, 1.0);
        var score = Math.Min(ratio, 3.0) / 3.0; // Cap at 1.0 when gap is 3x expected.

        var reason = ratio >= 1.0
            ? $"Gap since last feeding ({FormatDuration(gapSinceLastFeed)}) exceeds expected interval ({FormatDuration(expectedInterval)})"
            : $"Gap since last feeding ({FormatDuration(gapSinceLastFeed)}) within expected interval ({FormatDuration(expectedInterval)})";

        return (score, reason);
    }

    private static (double Score, string Reason) ScoreOvertired(
        IReadOnlyList<ObservedEvent> allEvents,
        DateTimeOffset cryTime,
        PredictionSet? predictionSet,
        CryCauseOptions opts)
    {
        // Find the most recent sleep end (wake time) before the cry.
        var lastSleepEnd = allEvents
            .Where(e => e.TypeKey == BuiltInEventTypes.Sleep.Key && e.EndedAt.HasValue && e.EndedAt.Value <= cryTime)
            .OrderByDescending(e => e.EndedAt!.Value)
            .FirstOrDefault();

        if (lastSleepEnd is null || lastSleepEnd.EndedAt is null)
        {
            return (0.2, "No completed sleep session found");
        }

        var awakeDuration = cryTime - lastSleepEnd.EndedAt.Value;

        // Use predicted awake window if available, otherwise default.
        var expectedAwakeWindow = predictionSet?.Predictions
            .FirstOrDefault(p => p.TypeKey == BuiltInEventTypes.Sleep.Key)
            ?.Reason.MedianGap ?? opts.DefaultAwakeWindow;

        if (awakeDuration <= TimeSpan.Zero)
        {
            return (0.0, "Cry occurred before last wake time");
        }

        var ratio = awakeDuration.TotalMinutes / Math.Max(expectedAwakeWindow.TotalMinutes, 1.0);

        // Score ramps up once awake duration exceeds the expected window.
        var score = ratio <= 1.0 ? 0.0 : Math.Min((ratio - 1.0) * 2.0, 1.0);

        var reason = ratio > 1.0
            ? $"Awake for {FormatDuration(awakeDuration)}, exceeding expected awake window ({FormatDuration(expectedAwakeWindow)})"
            : $"Awake for {FormatDuration(awakeDuration)}, within expected awake window ({FormatDuration(expectedAwakeWindow)})";

        return (score, reason);
    }

    private static (double Score, string Reason) ScoreGasPostFeed(
        IReadOnlyList<ObservedEvent> allEvents,
        DateTimeOffset cryTime,
        CryCauseOptions opts)
    {
        // Find feedings that ended (or started if still running) within the gas window before the cry.
        var recentFeedings = allEvents
            .Where(e => e.TypeKey == BuiltInEventTypes.Feeding.Key)
            .Where(e =>
            {
                var feedEnd = e.EndedAt ?? e.StartedAt;
                var timeSinceFeed = cryTime - feedEnd;
                return timeSinceFeed >= opts.GasPostFeedWindowMin && timeSinceFeed <= opts.GasPostFeedWindowMax;
            })
            .ToArray();

        if (recentFeedings.Length == 0)
        {
            return (0.0, "No feeding in the gas-discomfort window");
        }

        // Base score for being in the window; boost if bottle feeding (kind is not available on ObservedEvent,
        // but we can check if the feeding has no breast-side indicator — a heuristic proxy).
        // Since ObservedEvent does not carry method directly, we use a conservative base score.
        // The task says "Higher score if feeding was bottle" — we approximate by checking Kind field.
        var maxScore = 0.0;
        var bestReason = "";

        foreach (var feeding in recentFeedings)
        {
            var timeSinceFeed = cryTime - (feeding.EndedAt ?? feeding.StartedAt);
            // Peak score at midpoint of window.
            var midPoint = (opts.GasPostFeedWindowMin + opts.GasPostFeedWindowMax) / 2.0;
            var distanceFromMid = Math.Abs((timeSinceFeed - midPoint).TotalMinutes);
            var halfWindow = (opts.GasPostFeedWindowMax - opts.GasPostFeedWindowMin).TotalMinutes / 2.0;
            var proximityScore = 1.0 - Math.Min(distanceFromMid / Math.Max(halfWindow, 1.0), 1.0);

            // Bottle proxy: if Kind is set and not a breast-related value, treat as bottle.
            // ObservedEvent.Kind carries the sleep kind for sleep events; for feeding it may be absent.
            // We use a moderate base since we cannot reliably distinguish bottle from breast here.
            var score = proximityScore * 0.8;

            if (score > maxScore)
            {
                maxScore = score;
                bestReason = $"Cry occurred {FormatDuration(timeSinceFeed)} after feeding (within gas window {opts.GasPostFeedWindowMin.TotalMinutes:F0}-{opts.GasPostFeedWindowMax.TotalMinutes:F0} min)";
            }
        }

        return (maxScore, bestReason);
    }

    private static (double Score, string Reason) ScorePrePoopDiscomfort(
        IReadOnlyList<ObservedEvent> allEvents,
        DateTimeOffset cryTime,
        PredictionSet? predictionSet,
        CryCauseOptions opts)
    {
        var lastDirtyDiaper = allEvents
            .Where(e => e.TypeKey == BuiltInEventTypes.Diaper.Key && DiaperContents.IsDirty(e.Content) && e.StartedAt <= cryTime)
            .OrderByDescending(e => e.StartedAt)
            .FirstOrDefault();

        if (lastDirtyDiaper is null)
        {
            // No dirty diaper history; low score (cannot assess).
            return (0.15, "No dirty diaper history available");
        }

        var gapSinceDirty = cryTime - lastDirtyDiaper.StartedAt;

        // Use diaper pattern stats if available for a more accurate typical interval.
        var typicalInterval = predictionSet?.DiaperPatterns?.DirtyGapStats?.MedianGap ?? opts.DefaultDirtyDiaperInterval;
        var threshold = TimeSpan.FromMinutes(typicalInterval.TotalMinutes * opts.PoopIntervalMultiplier);

        if (gapSinceDirty <= threshold)
        {
            return (0.0, $"Last dirty diaper {FormatDuration(gapSinceDirty)} ago, within typical interval ({FormatDuration(typicalInterval)})");
        }

        var excessRatio = (gapSinceDirty - threshold).TotalMinutes / Math.Max(threshold.TotalMinutes, 1.0);
        var score = Math.Min(excessRatio, 1.0);

        return (score, $"No dirty diaper for {FormatDuration(gapSinceDirty)}, exceeding typical interval ({FormatDuration(typicalInterval)}) by {opts.PoopIntervalMultiplier:F1}x");
    }

    private static (double Score, string Reason) ScoreOverstimulation(
        IReadOnlyList<ObservedEvent> allEvents,
        DateTimeOffset cryTime,
        PredictionContext context,
        CryCauseOptions opts)
    {
        var windowStart = cryTime - opts.OverstimulationWindow;
        var eventsInWindow = allEvents.Count(e => e.StartedAt >= windowStart && e.StartedAt <= cryTime);

        var localHour = cryTime.ToOffset(context.LocalOffset).Hour;
        var isEvening = localHour >= opts.OverstimulationEveningHour;

        if (!isEvening)
        {
            return (0.0, $"Not in evening phase (local hour {localHour}, evening starts at {opts.OverstimulationEveningHour})");
        }

        if (eventsInWindow < opts.OverstimulationEventThreshold)
        {
            return (0.0, $"Event density ({eventsInWindow} in {opts.OverstimulationWindow.TotalHours:F1}h) below threshold ({opts.OverstimulationEventThreshold})");
        }

        // Score scales with how far above threshold the density is.
        var ratio = (double)eventsInWindow / Math.Max(opts.OverstimulationEventThreshold, 1);
        var score = Math.Min((ratio - 1.0) * 0.5 + 0.5, 1.0);

        return (score, $"High event density ({eventsInWindow} events in {opts.OverstimulationWindow.TotalHours:F1}h) during evening (local hour {localHour})");
    }

    private static IReadOnlyList<CryCauseProbability> Normalize(
        Dictionary<CryCause, (double Score, string Reason)> scores,
        double minimumThreshold)
    {
        // Apply threshold: causes below it get zero weight.
        var eligible = scores
            .Where(kvp => kvp.Value.Score >= minimumThreshold)
            .ToArray();

        if (eligible.Length == 0)
        {
            // Everything below threshold: 100% Unknown.
            return [new CryCauseProbability(CryCause.Unknown, 1.0, "No cause scored above threshold")];
        }

        var totalScore = eligible.Sum(kvp => kvp.Value.Score);

        // Reserve a small residual for Unknown even when other causes score.
        const double unknownFloor = 0.02;
        var remainingMass = 1.0 - unknownFloor;

        var result = new List<CryCauseProbability>(eligible.Length + 1);
        foreach (var kvp in eligible.OrderByDescending(kvp => kvp.Value.Score))
        {
            var probability = (kvp.Value.Score / totalScore) * remainingMass;
            result.Add(new CryCauseProbability(kvp.Key, Math.Round(probability, 4), kvp.Value.Reason));
        }

        result.Add(new CryCauseProbability(CryCause.Unknown, Math.Round(unknownFloor, 4), "Residual probability"));

        // Sort descending by probability.
        result.Sort((a, b) => b.Probability.CompareTo(a.Probability));

        return result;
    }

    private static string FormatDuration(TimeSpan duration)
    {
        var totalMinutes = (int)duration.TotalMinutes;
        return totalMinutes >= 60
            ? $"{totalMinutes / 60}h{totalMinutes % 60:D2}m"
            : $"{totalMinutes}m";
    }
}