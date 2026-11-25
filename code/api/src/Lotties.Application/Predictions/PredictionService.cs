using Lotties.Application.AgeNorms;
using Lotties.Application.Babies;
using Lotties.Domain.Babies;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Predictions;

internal sealed class PredictionService : IPredictionService
{
    private readonly IPredictionHistoryRepository _history;
    private readonly IBabyAccessService _access;
    private readonly IAgeNormsProvider _ageNorms;
    private readonly IEnumerable<IPriorProvider> _priorProviders;
    private readonly IPredictionOutcomeResolutionService _outcomeRecorder;
    private readonly PredictionAccuracyAdjustmentService _accuracyAdjustment;
    private readonly PredictionOptions _options;
    private readonly ILogger<PredictionService> _logger;

    public PredictionService(
        IPredictionHistoryRepository history,
        IBabyAccessService access,
        IAgeNormsProvider ageNorms,
        IEnumerable<IPriorProvider> priorProviders,
        IPredictionOutcomeResolutionService outcomeRecorder,
        PredictionAccuracyAdjustmentService accuracyAdjustment,
        PredictionOptions options,
        ILogger<PredictionService> logger)
    {
        _history = history ?? throw new ArgumentNullException(nameof(history));
        _access = access ?? throw new ArgumentNullException(nameof(access));
        _ageNorms = ageNorms ?? throw new ArgumentNullException(nameof(ageNorms));
        _priorProviders = priorProviders ?? throw new ArgumentNullException(nameof(priorProviders));
        _outcomeRecorder = outcomeRecorder ?? throw new ArgumentNullException(nameof(outcomeRecorder));
        _accuracyAdjustment = accuracyAdjustment ?? throw new ArgumentNullException(nameof(accuracyAdjustment));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<PredictionsResponse?> GetAsync(Guid babyId, DateTimeOffset now, string? timeZone = null, CancellationToken cancellationToken = default)
    {
        var stored = await _history.LoadAsync(babyId, now - _options.LookBack, cancellationToken);
        if (stored is null)
        {
            _logger.LogDebug("Predictions requested for unknown baby {BabyId}", babyId);
            return null;
        }

        var history = VisibleIn(stored, await _access.ViewOfCallerAsync(babyId, cancellationToken));
        var priorList = BuildPriorProviders();

        // Compute per-type accuracy adjustments from historical prediction outcomes.
        // This uses real MAE data from the prediction_outcomes table to adjust blending weights:
        // high MAE reduces trust in the prior, low MAE increases it.
        IReadOnlyDictionary<Lotties.Domain.EventTypes.EventTypeKey, double>? accuracyAdjustments = null;
        if (_options.AccuracyTrackingEnabled && _options.BlendingEnabled)
        {
            try
            {
                var typeKeys = history.Events.Select(e => e.TypeKey).Distinct().ToList();
                var adjustments = new Dictionary<Lotties.Domain.EventTypes.EventTypeKey, double>();
                foreach (var typeKey in typeKeys)
                {
                    var adj = await _accuracyAdjustment.GetAccuracyAdjustmentAsync(babyId, typeKey, ageBand: null, phase: null, cancellationToken);
                    if (adj.HasValue)
                    {
                        adjustments[typeKey] = adj.Value;
                    }
                }

                if (adjustments.Count > 0)
                {
                    accuracyAdjustments = adjustments;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to compute accuracy adjustments for baby {BabyId}; proceeding without", babyId);
            }
        }

        var predictions = PredictionEngine.Predict(history.Events, new PredictionContext(history.BirthDate, now), _options, _ageNorms.Norms, priorList, accuracyAdjustments);
        _logger.LogDebug(
            "Computed {PredictionCount} predictions for baby {BabyId} from {EventCount} events ({InsufficientCount} types lack data)",
            predictions.Predictions.Count,
            babyId,
            history.Events.Count,
            predictions.InsufficientData.Count);

        // Fire-and-forget: record outcomes for accuracy tracking without blocking the response.
        if (_options.AccuracyTrackingEnabled)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    foreach (var prediction in predictions.Predictions)
                    {
                        await _outcomeRecorder.RecordPredictionAsync(prediction, babyId, PredictionEngine.Version, cancellationToken: CancellationToken.None);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Fire-and-forget prediction outcome recording failed for baby {BabyId}", babyId);
                }
            });
        }

        var clock = LocalClock.ForZoneOrOffset(timeZone, now.Offset);

        // Defensive wrapper: if diaper pattern analysis or serialization throws (e.g. due to a
        // schema mismatch between PredictionSet.DiaperPatterns and DiaperPatternAnalysisResponse),
        // log the error and return null patterns instead of crashing the entire predictions endpoint
        // with a 500. This restores sleep/feeding predictions while preserving diagnostic data.
        DiaperPredictionsResponse? diaperResponse;
        try
        {
            diaperResponse = DiapersOf(history, now, predictions.DiaperPatterns);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Diaper predictions failed for baby {BabyId}; returning null to avoid 500", babyId);
            diaperResponse = null;
        }

        return PredictionsResponse.Create(babyId, now, predictions, Patterns(history, now, clock), WakeWindowOf(history, now, clock), diaperResponse);
    }

    /// <summary>The history of the event types the caller's view shows (a Doctor without medications predicts no medication dose).</summary>
    private static PredictionHistory VisibleIn(PredictionHistory history, SectionView view) =>
        history with { Events = history.Events.Where(item => view.ShowsType(item.TypeKey)).ToArray() };

    /// <summary>The next wet and dirty diaper (docs/design/11-patterns.md section 8); elapsed gaps, so no clock is needed.</summary>
    private static DiaperPredictionsResponse DiapersOf(PredictionHistory history, DateTimeOffset now, DiaperPatternAnalysis? patterns = null) =>
        DiaperPredictionsResponse.For(DiaperPredictions.Predict(history.Events, now), DiaperPredictionOptions.Default, patterns);

    /// <summary>The recurring patterns (docs/design/11-patterns.md): belly pain, then fussiness; only the ones found.</summary>
    private static IReadOnlyList<TimeOfDayPatternResponse> Patterns(PredictionHistory history, DateTimeOffset now, LocalClock clock)
    {
        var bellyPain = BellyPainPatterns.Detect(history.Events, now, clock) is { } belly
            ? TimeOfDayPatternResponse.For(BellyPainPatterns.PainTypeKey, belly, clock, RecurringTimeOfDayOptions.Default, BellyPainPatterns.Lead)
            : null;
        var fussy = FussyPatterns.Detect(history.Events, now, clock) is { } spells
            ? TimeOfDayPatternResponse.For(FussyPatterns.TypeKey, spells, clock, RecurringTimeOfDayOptions.Default, FussyPatterns.Lead)
            : null;
        return new[] { bellyPain, fussy }.OfType<TimeOfDayPatternResponse>().ToArray();
    }

    /// <summary>The overtired heads-up numbers (docs/design/11-patterns.md section 6), daytime read with <paramref name="clock"/>.</summary>
    private WakeWindowResponse? WakeWindowOf(PredictionHistory history, DateTimeOffset now, LocalClock clock) =>
        WakeWindows.Measure(history.Events, now, clock, WakeWindowOptions.Default, _options) is { } window
            ? WakeWindowResponse.For(window, now, clock, WakeWindowOptions.Default)
            : null;

    /// <summary>
    /// Builds the ordered prior provider chain for this prediction run. When live community priors are enabled,
    /// CommunityLive > CommunityStatic; otherwise just CommunityStatic. The age-norm fallback is handled by
    /// <see cref="PredictionEngine"/> via the <c>ageNorms</c> parameter (not added here because
    /// <c>AgeNormPriorProvider</c> is internal to Domain).
    /// </summary>
    private IReadOnlyList<IPriorProvider> BuildPriorProviders()
    {
        var providers = new List<IPriorProvider>();

        foreach (var provider in _priorProviders)
        {
            // CommunityLivePriorProvider self-gates on UseCommunityLivePriors inside GetPrior,
            // but we also skip adding it to keep the chain clean when disabled.
            if (!_options.UseCommunityLivePriors && provider is CommunityLivePriorProvider)
            {
                continue;
            }

            providers.Add(provider);
        }

        return providers;
    }
}
