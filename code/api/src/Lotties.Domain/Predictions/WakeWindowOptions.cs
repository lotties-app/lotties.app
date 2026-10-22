namespace Lotties.Domain.Predictions;

/// <summary>
/// The rules of <see cref="WakeWindows"/> (docs/design/11-patterns.md section 6). <see cref="Default"/> holds the shipped
/// values; other instances exist for tests.
/// </summary>
public sealed record WakeWindowOptions
{
    public static WakeWindowOptions Default { get; } = new();

    /// <summary>Only awake stretches that started this long before now or later count.</summary>
    public TimeSpan LookBack { get; init; } = TimeSpan.FromDays(14);

    /// <summary>A daytime stretch starts at this local time or later (inclusive).</summary>
    public TimeOnly DayStartsAt { get; init; } = new(5, 0);

    /// <summary>A daytime stretch starts before this local time (exclusive).</summary>
    public TimeOnly DayEndsAt { get; init; } = new(18, 0);

    /// <summary>The share of the stretches the usual longest comfortable stretch is the quantile of (0.75 = 75th percentile).</summary>
    public double Percentile { get; init; } = 0.75;

    /// <summary>Fewest usable stretches needed; with fewer there is no wake window (no guess).</summary>
    public int MinimumStretches { get; init; } = 5;

    /// <summary>Stretches shorter than this are ignored (overlapping or duplicate logs).</summary>
    public TimeSpan MinimumStretchLength { get; init; } = TimeSpan.FromMinutes(1);

    /// <summary>Stretches longer than this multiple of the plain median are ignored (a nap that was not logged).</summary>
    public double OutlierFactor { get; init; } = 3.0;

    /// <summary>A lone <c>fell_asleep</c> marker newer than the last wake means asleep for at most this long (as on Now).</summary>
    public TimeSpan LoneMarkerMaxAge { get; init; } = TimeSpan.FromHours(16);

    /// <summary>The heads-up (Now card and push) starts this long before the limit.</summary>
    public TimeSpan Lead { get; init; } = TimeSpan.FromMinutes(15);

    /// <summary>The Now card stays until this long after the limit; the push expires then.</summary>
    public TimeSpan Grace { get; init; } = TimeSpan.FromMinutes(30);
}
