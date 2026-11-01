using Lotties.Domain.Clinical;

namespace Lotties.Application.Clinical;

/// <summary>The sleep, feeding and diaper events of a window, read as the observations the summaries take.</summary>
internal sealed record DailyObservations(
    IReadOnlyList<SleepObservation> Sleep,
    IReadOnlyList<FeedObservation> Feeds,
    IReadOnlyList<DiaperObservation> Diapers);

/// <summary>
/// Loads the daily log events a <see cref="ClinicalWindow"/> needs in one query: sleep, feeding and diaper events that
/// started from two days before the first day (a night that began before the range and crosses into its first day) to three
/// hours after the last one (a bed time after midnight still belongs to the evening before), and not after now.
/// </summary>
internal sealed class DailyObservationReader(IClinicalEventRepository events)
{
    private const string SleepKey = "sleep";
    private const string FeedingKey = "feeding";
    private const string DiaperKey = "diaper";

    private static readonly TimeSpan LookBack = TimeSpan.FromDays(2);
    private static readonly TimeSpan LookAhead = TimeSpan.FromHours(3);
    private static readonly string[] Keys = [SleepKey, FeedingKey, DiaperKey];

    public async Task<DailyObservations> LoadAsync(Guid babyId, ClinicalWindow window, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(window);
        var upperBound = Earlier(window.Now.AddTicks(1), window.End + LookAhead);
        var loaded = await events.ListByTypesAsync(babyId, Keys, window.Start - LookBack, upperBound, cancellationToken);
        return new DailyObservations(
            loaded.Where(item => item.TypeKey.Value == SleepKey).Select(item => ClinicalObservations.Sleep(item.Event)).ToArray(),
            loaded.Where(item => item.TypeKey.Value == FeedingKey).Select(item => ClinicalObservations.Feed(item.Event)).ToArray(),
            loaded.Where(item => item.TypeKey.Value == DiaperKey).Select(item => ClinicalObservations.Diaper(item.Event)).ToArray());
    }

    private static DateTimeOffset Earlier(DateTimeOffset first, DateTimeOffset second) => first <= second ? first : second;
}
