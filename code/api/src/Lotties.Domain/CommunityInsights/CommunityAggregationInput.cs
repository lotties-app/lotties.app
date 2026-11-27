namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// Everything one aggregation run reads (docs/design/34-community-insights.md section 5), derived in memory by the caller from the
/// opted-in, eligible babies of the run's population snapshot (<c>CommunityPopulation</c>): the validated catalog, the generation
/// time, the secret cap key and the per-baby observations of each v1 statistic. The ids
/// are used only to count distinct babies and families and to pick capped days; they never reach the release.
/// </summary>
public sealed record CommunityAggregationInput(
    CommunityStatisticsCatalog Catalog,
    DateTimeOffset GeneratedAt,
    CommunityCapKey CapKey,
    IReadOnlyList<CommunityTummyTimeDay> TummyTimeDays,
    IReadOnlyList<CommunityCrySpell> CrySpells);

/// <summary>
/// One complete local day of an opted-in baby for <c>tummy_minutes_per_day</c>: her family (the babies sharing an Owner), her age
/// in completed weeks on that day, the day, and the effective tummy time minutes that day (0 when none was logged; the day still
/// counts for the share of days with any). Several rows of one baby and day are added up.
/// </summary>
public sealed record CommunityTummyTimeDay(Guid BabyId, Guid FamilyId, int AgeWeeks, DateOnly LocalDay, decimal TummyMinutes);

/// <summary>
/// One answered <c>fussy</c> spell of an opted-in baby for <c>cry_outcome_by_cause</c>: her family, her age in completed weeks on the
/// local day of the spell, the day, and the cause that helped (<see cref="CommunityCryCauses.Helped"/>, from
/// <see cref="CommunityCryCauses.FromWhatHelped"/>). Nothing else of the spell is read (no part of day, no suggested cause, no
/// duration). A spell with an unknown cause is not read.
/// </summary>
public sealed record CommunityCrySpell(Guid BabyId, Guid FamilyId, int AgeWeeks, DateOnly LocalDay, string HelpedCause);

/// <summary>One observation of one share output, before its band: which category it falls in (<see cref="Component"/>).</summary>
internal readonly record struct CommunitySample(Guid BabyId, Guid FamilyId, int AgeWeeks, DateOnly Day, string? Dimension, string Output, int Component);

/// <summary>One observation located in its fine cell.</summary>
internal readonly record struct CommunityCellSample(Guid BabyId, Guid FamilyId, DateOnly Day, CommunityCellKey Cell, string Output, int Component);

/// <summary>Turns one statistic's typed observations into share samples of its v1 outputs, after clipping and validation.</summary>
internal interface ICommunityStatisticSampler
{
    /// <summary>The catalog inputs this sampler reads; a statistic in v1 must list exactly these (the published list).</summary>
    IReadOnlyList<string> Reads { get; }

    bool CanHandle(CommunityStatistic statistic);

    IEnumerable<CommunitySample> SamplesOf(CommunityStatistic statistic, CommunityAggregationInput input);
}

/// <summary><c>tummy_minutes_per_day</c>: one sample per baby and day of <c>share_of_days_with_any</c>, "with" when the clipped minutes are above 0.</summary>
internal sealed class TummyTimeSampler : ICommunityStatisticSampler
{
    public const string Key = "tummy_minutes_per_day";

    private static readonly CommunityShareOutput Output = CommunityOutputs.Shares[CommunityOutputs.ShareOfDaysWithAny];

    public IReadOnlyList<string> Reads { get; } = ["age_weeks", "local_day", Key];

    public bool CanHandle(CommunityStatistic statistic) => statistic.Key == Key;

    public IEnumerable<CommunitySample> SamplesOf(CommunityStatistic statistic, CommunityAggregationInput input)
    {
        var clip = statistic.ClipOf(Key);
        var wanted = statistic.V1Outputs.Any(output => output.Name == Output.Name);
        return wanted
            ? input.TummyTimeDays.GroupBy(day => new BabyDay(day.BabyId, day.LocalDay)).Select(group => SampleOf(group, clip))
            : [];
    }

    private static CommunitySample SampleOf(IGrouping<BabyDay, CommunityTummyTimeDay> group, CommunityClip? clip)
    {
        var first = group.First();
        var minutes = group.Sum(day => day.TummyMinutes);
        var clipped = clip?.Apply(minutes) ?? minutes;
        return new CommunitySample(first.BabyId, first.FamilyId, first.AgeWeeks, first.LocalDay, null, Output.Name, clipped > 0m ? 0 : 1);
    }

    private readonly record struct BabyDay(Guid BabyId, DateOnly Day);
}

/// <summary><c>cry_outcome_by_cause</c>: per answered spell, one sample of <c>share_helped_by_cause</c>, the cause that helped.</summary>
internal sealed class CryOutcomeSampler : ICommunityStatisticSampler
{
    public const string Key = "cry_outcome_by_cause";

    private static readonly CommunityShareOutput Helped = CommunityOutputs.Shares[CommunityOutputs.ShareHelpedByCause];

    public IReadOnlyList<string> Reads { get; } = ["age_weeks", "local_day", "what_helped_cause"];

    public bool CanHandle(CommunityStatistic statistic) => statistic.Key == Key;

    public IEnumerable<CommunitySample> SamplesOf(CommunityStatistic statistic, CommunityAggregationInput input)
    {
        var wanted = statistic.V1Outputs.Any(output => output.Name == Helped.Name);
        return wanted
            ? input.CrySpells.Where(spell => CommunityCryCauses.Helped.Contains(spell.HelpedCause)).Select(SampleOf)
            : [];
    }

    private static CommunitySample SampleOf(CommunityCrySpell spell) =>
        new(spell.BabyId, spell.FamilyId, spell.AgeWeeks, spell.LocalDay, null, Helped.Name, Helped.IndexOf(spell.HelpedCause));
}