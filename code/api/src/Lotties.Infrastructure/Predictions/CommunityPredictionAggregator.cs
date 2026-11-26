using Lotties.Application.CommunityInsights;
using Lotties.Domain.Babies;
using Lotties.Domain.Common;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Predictions;
using Lotties.Domain.Users;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.Configurations;
using Lotties.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Lotties.Infrastructure.Predictions;

/// <summary>
/// Aggregates resolved prediction outcomes into anonymized community aggregates (docs/design/34-community-insights.md section 5,
/// docs/design/33-privacy-audit.md section 20.1). <b>Not registered in DI and called by nothing</b>: wiring it is an activation of its
/// own (a policy change first).
/// </summary>
/// <remarks>
/// <para>
/// Population: the consent snapshot of <see cref="CommunityAggregationJob"/> (<see cref="CommunityPopulation.SnapshotAsync"/>: a current
/// community consent, a real Owner, and settled on the built-in store), taken once at run start, so a withdrawal takes effect on the
/// next run. Babies with any demo member are left out too. Only the Lotties database is read: a baby on the family's own database (or
/// with a move between stores in progress or in its undo window) is not in the snapshot, so she is never read in her store (design 47
/// section 2.2).
/// </para>
/// <para>
/// A cell is (age band, type, phase, engine version). It is stored only with at least <see cref="CommunityStatisticsValidator.MinimumK"/>
/// distinct babies from as many distinct families (a family is the set of babies sharing an Owner) and when no family gave more than
/// <see cref="CommunityStatisticsAggregator.FamilyDominanceThreshold"/> of its outcomes
/// (<see cref="CommunityStatisticsAggregator.IsDominatedByOneFamily"/>). Each run replaces the whole table in one save: cells that no
/// longer qualify and rows of earlier runs are removed. Labels come from <see cref="CommunityPredictionAggregateLabels"/>, the source the
/// reader looks them up with. The output has no baby id or PII.
/// </para>
/// </remarks>
internal sealed class CommunityPredictionAggregator(
    LottiesDbContext context,
    ICommunityConsentRepository consents,
    TimeProvider time,
    ILogger<CommunityPredictionAggregator> logger) : ICommunityPredictionAggregator
{
    /// <summary>Minimum distinct babies, and distinct families, per stored cell (shared with the community statistics).</summary>
    public const int MinimumBabiesAndFamilies = CommunityStatisticsValidator.MinimumK;

    /// <summary>
    /// Runs the aggregation pipeline and replaces the table with the cells that qualify. Returns the number of aggregates written.
    /// </summary>
    public async Task<int> AggregateAsync(CancellationToken cancellationToken = default)
    {
        var now = time.GetUtcNow();
        var temporalBucket = IsoWeekLabel.Of(now);

        var population = await CommunityPopulation.SnapshotAsync(consents, cancellationToken);
        var families = await FamiliesAsync(population.Eligible, cancellationToken);
        var outcomes = await LoadOutcomesAsync(families, cancellationToken);
        var cells = Qualifying(outcomes, out var suppressed);

        if (suppressed > 0)
        {
            logger.LogInformation(
                "Suppressed {Suppressed} community prediction aggregate cells below {Minimum} babies and families or dominated by one family",
                suppressed, MinimumBabiesAndFamilies);
        }

        var written = await ReplaceAsync(cells, temporalBucket, now, cancellationToken);
        logger.LogInformation("Wrote {Count} community prediction aggregates for bucket {Bucket}", written, temporalBucket);
        return written;
    }

    /// <summary>The cells of at least k babies from k families that no family dominates; counts the others in <paramref name="suppressed"/>.</summary>
    internal static IReadOnlyList<Cell> Qualifying(IReadOnlyList<Outcome> outcomes, out int suppressed)
    {
        var cells = new List<Cell>();
        suppressed = 0;
        foreach (var group in outcomes.GroupBy(outcome => outcome.Key))
        {
            var values = group.ToList();
            var families = values.Select(value => value.FamilyId).ToList();
            if (values.Select(value => value.BabyId).Distinct().Count() < MinimumBabiesAndFamilies
                || families.Distinct().Count() < MinimumBabiesAndFamilies
                || values.Count < CommunityPredictionAggregate.MinimumCount
                || CommunityStatisticsAggregator.IsDominatedByOneFamily(families))
            {
                suppressed++;
                continue;
            }

            var errors = values.Select(value => value.ErrorMinutes).Order().ToList();
            cells.Add(new Cell(
                group.Key,
                errors.Count,
                errors.Sum(),
                errors.Sum(error => error * error),
                Percentile(errors, 50),
                Percentile(errors, 10),
                Percentile(errors, 90)));
        }

        return cells;
    }

    /// <summary>
    /// The family of each baby (babies sharing an Owner are one family; its id is the smallest baby id in it), leaving out every baby
    /// with a demo member.
    /// </summary>
    private async Task<IReadOnlyDictionary<Guid, Guid>> FamiliesAsync(IReadOnlyList<Guid> babyIds, CancellationToken cancellationToken)
    {
        if (babyIds.Count == 0)
        {
            return new Dictionary<Guid, Guid>();
        }

        var members = await context.BabyMembers.AsNoTracking()
            .Where(member => babyIds.Contains(member.BabyId))
            .Join(context.Users.AsNoTracking(), member => member.UserId, user => user.Id, (member, user) => new { member.BabyId, member.UserId, member.Role, user.Issuer })
            .ToListAsync(cancellationToken);

        var withDemoMember = members.Where(member => member.Issuer == User.DemoIssuer).Select(member => member.BabyId).ToHashSet();
        var babies = babyIds.Where(baby => !withDemoMember.Contains(baby)).ToHashSet();
        var owners = members
            .Where(member => member.Role == BabyRole.Owner && babies.Contains(member.BabyId))
            .Select(member => (member.UserId, member.BabyId))
            .ToList();
        return FamiliesOf(babies, owners);
    }

    /// <summary>Groups <paramref name="babies"/> into families: two babies with a common Owner (directly or through other babies) are one.</summary>
    internal static IReadOnlyDictionary<Guid, Guid> FamiliesOf(IReadOnlyCollection<Guid> babies, IEnumerable<(Guid OwnerId, Guid BabyId)> owners)
    {
        var root = babies.ToDictionary(baby => baby, baby => baby);
        Guid Find(Guid baby)
        {
            while (root[baby] != baby)
            {
                root[baby] = root[root[baby]];
                baby = root[baby];
            }

            return baby;
        }

        foreach (var owner in owners.Where(owner => root.ContainsKey(owner.BabyId)).GroupBy(owner => owner.OwnerId))
        {
            var first = owner.First().BabyId;
            foreach (var (_, baby) in owner.Skip(1))
            {
                var (a, b) = (Find(first), Find(baby));
                if (a != b)
                {
                    root[b] = a;
                }
            }
        }

        var familyOf = new Dictionary<Guid, Guid>();
        foreach (var family in babies.GroupBy(Find))
        {
            var familyId = family.Min();
            foreach (var baby in family)
            {
                familyOf[baby] = familyId;
            }
        }

        return familyOf;
    }

    private async Task<IReadOnlyList<Outcome>> LoadOutcomesAsync(IReadOnlyDictionary<Guid, Guid> familyOf, CancellationToken cancellationToken)
    {
        if (familyOf.Count == 0)
        {
            return [];
        }

        var babyIds = familyOf.Keys.ToList();

        // Resolved outcomes with an error and an age band, of the population's babies only (built-in store: the Lotties database).
        var rows = await context.PredictionOutcomes.AsNoTracking()
            .Where(o => babyIds.Contains(o.BabyId) && o.Resolved && o.ErrorMinutes != null && o.AgeBand != null)
            .Select(o => new { o.BabyId, o.TypeKey, o.Phase, o.AgeBand, o.EngineVersion, ErrorMinutes = o.ErrorMinutes!.Value })
            .ToListAsync(cancellationToken);

        var outcomes = new List<Outcome>(rows.Count);
        foreach (var row in rows)
        {
            // prediction_outcomes stores the enum names (EfPredictionOutcomeRepository); a row with any other value is left out.
            var band = StoredEnum<AgeBand>(row.AgeBand);
            var phase = StoredEnum<DayPhase>(row.Phase);
            if (band is null
                || (row.Phase is not null && phase is null)
                || row.TypeKey.Length > CommunityPredictionAggregateConfiguration.TypeKeyMaxLength
                || row.EngineVersion.Length > CommunityPredictionAggregateConfiguration.EngineVersionMaxLength)
            {
                continue;
            }

            outcomes.Add(new Outcome(row.BabyId, familyOf[row.BabyId], new CellKey(band.Value, row.TypeKey, phase, row.EngineVersion), Math.Abs(row.ErrorMinutes)));
        }

        return outcomes;
    }

    /// <summary>The member named <paramref name="stored"/> (case-insensitive name only, never a number), else <c>null</c>.</summary>
    private static TEnum? StoredEnum<TEnum>(string? stored)
        where TEnum : struct, Enum =>
        Enum.GetNames<TEnum>().FirstOrDefault(name => string.Equals(name, stored, StringComparison.OrdinalIgnoreCase)) is { } name
            ? Enum.Parse<TEnum>(name)
            : null;

    /// <summary>Replaces every stored row with <paramref name="cells"/> in one save (rows of the same dimensions are updated in place).</summary>
    private async Task<int> ReplaceAsync(IReadOnlyList<Cell> cells, string temporalBucket, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var existing = await context.CommunityPredictionAggregates.ToListAsync(cancellationToken);
        var byDimensions = existing.ToDictionary(row => (row.AgeBandLabel, row.TypeKey, row.Phase, row.TemporalBucket, row.EngineVersion));
        var kept = new HashSet<CommunityPredictionAggregateEntity>(ReferenceEqualityComparer.Instance);

        foreach (var cell in cells)
        {
            var ageBandLabel = CommunityPredictionAggregateLabels.OfAgeBand(cell.Key.AgeBand);
            var phaseLabel = CommunityPredictionAggregateLabels.OfPhase(cell.Key.Phase);
            if (!byDimensions.TryGetValue((ageBandLabel, cell.Key.TypeKey, phaseLabel, temporalBucket, cell.Key.EngineVersion), out var row))
            {
                row = new CommunityPredictionAggregateEntity
                {
                    Id = Guid.NewGuid(),
                    AgeBandLabel = ageBandLabel,
                    TypeKey = cell.Key.TypeKey,
                    Phase = phaseLabel,
                    TemporalBucket = temporalBucket,
                    EngineVersion = cell.Key.EngineVersion,
                };
                context.CommunityPredictionAggregates.Add(row);
            }

            row.Count = cell.Count;
            row.SumErrorMinutes = cell.SumErrorMinutes;
            row.SumSquaredError = cell.SumSquaredError;
            row.MedianErrorMinutes = cell.Median;
            row.P10ErrorMinutes = cell.P10;
            row.P90ErrorMinutes = cell.P90;
            row.GeneratedAtUtc = now;
            kept.Add(row);
        }

        var removed = existing.Where(row => !kept.Contains(row)).ToList();
        context.CommunityPredictionAggregates.RemoveRange(removed);
        await context.SaveChangesAsync(cancellationToken);
        if (removed.Count > 0)
        {
            logger.LogInformation("Removed {Count} community prediction aggregates that no longer qualify or belong to an earlier run", removed.Count);
        }

        return cells.Count;
    }

    /// <summary>Computes the p-th percentile of a sorted list using linear interpolation.</summary>
    private static double? Percentile(List<double> sortedValues, int percentile)
    {
        if (sortedValues.Count == 0)
        {
            return null;
        }

        if (sortedValues.Count == 1)
        {
            return sortedValues[0];
        }

        var index = (percentile / 100.0) * (sortedValues.Count - 1);
        var lower = (int)Math.Floor(index);
        var upper = (int)Math.Ceiling(index);
        var fraction = index - lower;

        return sortedValues[lower] + fraction * (sortedValues[upper] - sortedValues[lower]);
    }

    /// <summary>The dimensions of one cell.</summary>
    internal sealed record CellKey(AgeBand AgeBand, string TypeKey, DayPhase? Phase, string EngineVersion);

    /// <summary>One resolved outcome of a baby of the population (absolute error in minutes).</summary>
    internal sealed record Outcome(Guid BabyId, Guid FamilyId, CellKey Key, double ErrorMinutes);

    /// <summary>One qualifying cell's metrics.</summary>
    internal sealed record Cell(CellKey Key, int Count, double SumErrorMinutes, double SumSquaredError, double? Median, double? P10, double? P90);
}
