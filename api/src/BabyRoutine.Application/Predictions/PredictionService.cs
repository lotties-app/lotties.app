using BabyRoutine.Domain.Predictions;
using Microsoft.Extensions.Logging;

namespace BabyRoutine.Application.Predictions;

internal sealed class PredictionService : IPredictionService
{
    private readonly IPredictionHistoryRepository _history;
    private readonly PredictionOptions _options;
    private readonly ILogger<PredictionService> _logger;

    public PredictionService(IPredictionHistoryRepository history, PredictionOptions options, ILogger<PredictionService> logger)
    {
        _history = history ?? throw new ArgumentNullException(nameof(history));
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<PredictionsResponse?> GetAsync(Guid babyId, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        var history = await _history.LoadAsync(babyId, now - _options.LookBack, cancellationToken);
        if (history is null)
        {
            _logger.LogDebug("Predictions requested for unknown baby {BabyId}", babyId);
            return null;
        }

        var predictions = PredictionEngine.Predict(history.Events, new PredictionContext(history.BirthDate, now), _options);
        _logger.LogDebug(
            "Computed {PredictionCount} predictions for baby {BabyId} from {EventCount} events ({InsufficientCount} types lack data)",
            predictions.Predictions.Count,
            babyId,
            history.Events.Count,
            predictions.InsufficientData.Count);
        return PredictionsResponse.Create(babyId, now, predictions);
    }
}
