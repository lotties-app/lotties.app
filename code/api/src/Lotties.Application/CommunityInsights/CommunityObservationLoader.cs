using Lotties.Domain.CommunityInsights;

namespace Lotties.Application.CommunityInsights;

/// <summary>
/// The observations one run read and what it left out (counts only): <see cref="BabiesRead"/> babies were read,
/// <see cref="BabiesLeftOut"/> of the population snapshot were not (consent changed since the snapshot, a demo member, no longer
/// settled on the built-in store, or nothing to read yet).
/// </summary>
public sealed record CommunityLoadedObservations(
    IReadOnlyList<CommunityTummyTimeDay> TummyTimeDays,
    IReadOnlyList<CommunityCrySpell> CrySpells,
    IReadOnlyList<CommunityBottleFeed> BottleFeeds,
    IReadOnlyList<CommunityRoutineDay> RoutineDays,
    int BabiesRead,
    int BabiesLeftOut);

/// <summary>
/// Loads the observations of a run's eligible babies (docs/design/34-community-insights.md section 5.3), one baby at a time so only
/// one baby's events are in memory at once: her subject (control plane), her span in time (from the first full day after her consent
/// in force to the day before the run), a fresh eligibility check right before her records are read (the snapshot's rule, so a baby
/// whose move between stores started since is not read), then her events through the store scope (built-in store only) and the pure
/// <see cref="CommunityObservationDeriver"/>. Her rows are dropped as soon as her observations are derived.
/// </summary>
internal sealed class CommunityObservationLoader(ICommunityEventSource source, ICommunityConsentRepository consents)
{
    public async Task<CommunityLoadedObservations> LoadAsync(IReadOnlyList<Guid> eligible, DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(eligible);
        var subjects = await source.SubjectsAsync(eligible, CommunityConsentTexts.CurrentTextVersion, cancellationToken);
        var loaded = new List<CommunityBabyObservations?>(subjects.Count);
        foreach (var subject in subjects)
        {
            loaded.Add(await LoadOneAsync(subject, now, cancellationToken));
        }

        var read = loaded.OfType<CommunityBabyObservations>().ToArray();
        return new CommunityLoadedObservations(
            [.. read.SelectMany(baby => baby.TummyTimeDays)],
            [.. read.SelectMany(baby => baby.CrySpells)],
            [.. read.SelectMany(baby => baby.BottleFeeds)],
            [.. read.SelectMany(baby => baby.RoutineDays)],
            read.Length,
            eligible.Count - read.Length);
    }

    /// <summary>One baby's observations, or <c>null</c> when nothing of hers is read.</summary>
    private async Task<CommunityBabyObservations?> LoadOneAsync(CommunitySubject subject, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var span = CommunityReadSpan.For(subject.ConsentedAt, now);
        var rows = span.HasDays && await IsStillEligibleAsync(subject.BabyId, cancellationToken)
            ? await source.ReadAsync(subject.BabyId, span.ReadFrom, span.ReadBefore, cancellationToken)
            : null;
        return rows is null ? null : CommunityObservationDeriver.Derive(subject, rows, span);
    }

    private async Task<bool> IsStillEligibleAsync(Guid babyId, CancellationToken cancellationToken) =>
        (await consents.FilterEligibleBabiesAsync([babyId], cancellationToken)).Contains(babyId);
}
