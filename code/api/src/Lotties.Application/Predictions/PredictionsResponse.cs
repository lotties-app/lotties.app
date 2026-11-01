using System.Globalization;
using Lotties.Domain.Predictions;

namespace Lotties.Application.Predictions;

/// <summary>The body of <c>GET /api/v1/babies/{babyId}/predictions</c>. Times are UTC; lengths are whole minutes.</summary>
public sealed class PredictionsResponse
{
    public Guid BabyId { get; set; }

    public DateTimeOffset GeneratedAt { get; set; }

    /// <summary>Version of the prediction rules (e.g. <c>heuristic-1.1</c>).</summary>
    public string EngineVersion { get; set; } = string.Empty;

    /// <summary>One entry per event type that could be predicted, ordered by type key.</summary>
    public IReadOnlyList<PredictionResponse> Predictions { get; set; } = [];

    /// <summary>Event types that have recent events but too few intervals to predict.</summary>
    public IReadOnlyList<InsufficientDataResponse> InsufficientData { get; set; } = [];

    /// <summary>The next night's start (bed time), or <c>null</c> when there is none to predict.</summary>
    public BedTimePredictionResponse? BedTime { get; set; }

    /// <summary>Recurring time-of-day patterns (additive): one entry per event type that has one (<c>belly_pain</c>, <c>fussy</c>).</summary>
    public IReadOnlyList<TimeOfDayPatternResponse> Patterns { get; set; } = [];

    /// <summary>The overtired heads-up numbers (additive), or <c>null</c> with too few daytime awake stretches.</summary>
    public WakeWindowResponse? WakeWindow { get; set; }

    /// <summary>The next wet and dirty diaper (additive); each part <c>null</c> when its gate did not pass.</summary>
    public DiaperPredictionsResponse? Diaper { get; set; }

    public static PredictionsResponse Create(
        Guid babyId,
        DateTimeOffset generatedAt,
        PredictionSet predictions,
        IReadOnlyList<TimeOfDayPatternResponse>? patterns = null,
        WakeWindowResponse? wakeWindow = null,
        DiaperPredictionsResponse? diaper = null)
    {
        ArgumentNullException.ThrowIfNull(predictions);
        return new PredictionsResponse
        {
            Patterns = patterns ?? [],
            WakeWindow = wakeWindow,
            Diaper = diaper,
            BabyId = babyId,
            GeneratedAt = generatedAt.ToUniversalTime(),
            EngineVersion = predictions.EngineVersion,
            Predictions = predictions.Predictions.Select(prediction => (PredictionResponse)prediction).ToArray(),
            InsufficientData = predictions.InsufficientData.Select(missing => (InsufficientDataResponse)missing).ToArray(),
            BedTime = predictions.BedTime is { } bedTime ? (BedTimePredictionResponse)bedTime : null,
        };
    }
}

/// <summary>
/// The next night's start, predicted from recent bed-time clocks. Same shape as <see cref="PredictionResponse"/> plus
/// <see cref="Kind"/>, with its own <see cref="Basis"/> (kind <c>BedTimeClock</c>).
/// </summary>
public sealed class BedTimePredictionResponse
{
    /// <summary>The sleep type key (<c>sleep</c>).</summary>
    public string TypeKey { get; set; } = string.Empty;

    /// <summary>The sleep payload kind predicted: <c>night</c>.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Earliest (q25), expected (median) and latest (q75) bed time, UTC.</summary>
    public NextStartWindowResponse NextStart { get; set; } = new();

    /// <summary>Typical night duration (finished night sessions only), or <c>null</c> with too few nights.</summary>
    public ExpectedDurationResponse? ExpectedDuration { get; set; }

    /// <summary><c>Low</c>, <c>Medium</c> or <c>High</c>.</summary>
    public string Confidence { get; set; } = string.Empty;

    /// <summary>Number of bed-time clocks behind <see cref="NextStart"/>.</summary>
    public int SampleCount { get; set; }

    /// <summary>English explanation, rendered from <see cref="Basis"/>.</summary>
    public string Reason { get; set; } = string.Empty;

    public BedTimeBasisResponse Basis { get; set; } = new();

    public static implicit operator BedTimePredictionResponse(BedTimePrediction prediction)
    {
        ArgumentNullException.ThrowIfNull(prediction);
        return new BedTimePredictionResponse
        {
            TypeKey = prediction.TypeKey.Value,
            Kind = prediction.Kind,
            NextStart = prediction.NextStart,
            ExpectedDuration = prediction.ExpectedDuration is { } duration ? (ExpectedDurationResponse)duration : null,
            Confidence = prediction.Confidence.ToString(),
            SampleCount = prediction.SampleCount,
            Reason = prediction.Reason.Text,
            Basis = prediction.Reason,
        };
    }
}

/// <summary>The structured parts of a bed-time prediction's reason, for clients that render their own text.</summary>
public sealed class BedTimeBasisResponse
{
    /// <summary><c>BedTimeClock</c>.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Bed times later than now's clock, the samples of the window.</summary>
    public int SampleCount { get; set; }

    /// <summary>Recent bed times considered (one per evening, at most 14).</summary>
    public int RecentBedTimeCount { get; set; }

    public int LookBackDays { get; set; }

    /// <summary>Local clock time (<c>HH:mm</c>, family offset) of the expected bed time.</summary>
    public string MedianClock { get; set; } = string.Empty;

    public static implicit operator BedTimeBasisResponse(BedTimeReason reason)
    {
        ArgumentNullException.ThrowIfNull(reason);
        return new BedTimeBasisResponse
        {
            Kind = reason.Basis.ToString(),
            SampleCount = reason.SampleCount,
            RecentBedTimeCount = reason.RecentBedTimeCount,
            LookBackDays = WholeDays.Of(reason.LookBack),
            MedianClock = reason.MedianClock.ToString("HH:mm", CultureInfo.InvariantCulture),
        };
    }
}

/// <summary>A prediction for one event type.</summary>
public sealed class PredictionResponse
{
    public string TypeKey { get; set; } = string.Empty;

    public NextStartWindowResponse NextStart { get; set; } = new();

    /// <summary>Typical duration, or <c>null</c> for instant types or too few finished events.</summary>
    public ExpectedDurationResponse? ExpectedDuration { get; set; }

    /// <summary><c>Low</c>, <c>Medium</c> or <c>High</c>.</summary>
    public string Confidence { get; set; } = string.Empty;

    /// <summary>Number of intervals behind <see cref="NextStart"/>.</summary>
    public int SampleCount { get; set; }

    /// <summary>English explanation, rendered from <see cref="Basis"/>.</summary>
    public string Reason { get; set; } = string.Empty;

    public PredictionBasisResponse Basis { get; set; } = new();

    public static implicit operator PredictionResponse(Prediction prediction)
    {
        ArgumentNullException.ThrowIfNull(prediction);
        return new PredictionResponse
        {
            TypeKey = prediction.TypeKey.Value,
            NextStart = prediction.NextStart,
            ExpectedDuration = prediction.ExpectedDuration is { } duration ? (ExpectedDurationResponse)duration : null,
            Confidence = prediction.Confidence.ToString(),
            SampleCount = prediction.SampleCount,
            Reason = prediction.Reason.Text,
            Basis = prediction.Reason,
        };
    }
}

public sealed class NextStartWindowResponse
{
    public DateTimeOffset Earliest { get; set; }

    /// <summary>The median estimate.</summary>
    public DateTimeOffset Expected { get; set; }

    public DateTimeOffset Latest { get; set; }

    public static implicit operator NextStartWindowResponse(NextStartWindow window)
    {
        ArgumentNullException.ThrowIfNull(window);
        return new NextStartWindowResponse
        {
            Earliest = window.Earliest,
            Expected = window.Expected,
            Latest = window.Latest,
        };
    }
}

public sealed class ExpectedDurationResponse
{
    public int Minutes { get; set; }

    public int SampleCount { get; set; }

    public static implicit operator ExpectedDurationResponse(DurationEstimate duration)
    {
        ArgumentNullException.ThrowIfNull(duration);
        return new ExpectedDurationResponse
        {
            Minutes = WholeMinutes.Of(duration.Median),
            SampleCount = duration.SampleCount,
        };
    }
}

/// <summary>The structured parts of a prediction's reason, for clients that render their own text.</summary>
public sealed class PredictionBasisResponse
{
    /// <summary><c>StartInterval</c> or <c>AwakeWindow</c>.</summary>
    public string Kind { get; set; } = string.Empty;

    /// <summary>Median interval between starts, or median awake window.</summary>
    public int MedianGapMinutes { get; set; }

    public int LookBackDays { get; set; }

    /// <summary>Age band the samples were limited to (<c>0-3m</c>, <c>3-6m</c>, <c>6-12m</c>, <c>12m+</c>), or <c>null</c> for all ages.</summary>
    public string? AgeBand { get; set; }

    /// <summary><c>day</c> or <c>night</c> when the samples were limited to that phase, otherwise <c>null</c>.</summary>
    public string? DayPhase { get; set; }

    /// <summary>The last event is still running and the next start is measured from its expected end.</summary>
    public bool AssumesEventInProgressEnds { get; set; }

    public static implicit operator PredictionBasisResponse(PredictionReason reason)
    {
        ArgumentNullException.ThrowIfNull(reason);
        return new PredictionBasisResponse
        {
            Kind = reason.Basis.ToString(),
            MedianGapMinutes = WholeMinutes.Of(reason.MedianGap),
            LookBackDays = WholeDays.Of(reason.LookBack),
            AgeBand = reason.AgeBand is { } band ? AgeBands.Label(band) : null,
            DayPhase = reason.Phase is { } phase ? DayPhases.Label(phase) : null,
            AssumesEventInProgressEnds = reason.AssumesEventInProgressEnds,
        };
    }
}

/// <summary>An event type with recent events but not enough intervals to predict.</summary>
public sealed class InsufficientDataResponse
{
    public string TypeKey { get; set; } = string.Empty;

    public int SampleCount { get; set; }

    public int RequiredSamples { get; set; }

    public string Reason { get; set; } = string.Empty;

    public static implicit operator InsufficientDataResponse(InsufficientPredictionData missing)
    {
        ArgumentNullException.ThrowIfNull(missing);
        return new InsufficientDataResponse
        {
            TypeKey = missing.TypeKey.Value,
            SampleCount = missing.SampleCount,
            RequiredSamples = missing.RequiredSamples,
            Reason = missing.Reason,
        };
    }
}

internal static class WholeMinutes
{
    public static int Of(TimeSpan value) => (int)Math.Round(value.TotalMinutes, MidpointRounding.AwayFromZero);
}

internal static class WholeDays
{
    public static int Of(TimeSpan value) => (int)Math.Round(value.TotalDays, MidpointRounding.AwayFromZero);
}
