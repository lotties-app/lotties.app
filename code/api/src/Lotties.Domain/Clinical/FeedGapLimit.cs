using Lotties.Domain.AgeNorms;

namespace Lotties.Domain.Clinical;

/// <summary>
/// The longest gap between two feed starts that still counts as a real gap in the feeding averages; a longer one means a
/// feed was probably not logged. 8 hours by default; from 6 months of age, when a published norm usable as a prior covers
/// the age, the published longest sleep period's high end (else the night sleep's), between 8 and 14 hours, because older
/// babies really do sleep longer than 8 hours without a feed (docs/design/28-age-norms.md section 15.2). The web twin is
/// <c>feedGapLimit.ts</c>; both run the shared vectors.
/// </summary>
public sealed class FeedGapLimit
{
    /// <summary>The cut-off without a usable norm (and always under <see cref="NormFromAgeDays"/>).</summary>
    public static readonly TimeSpan Default = TimeSpan.FromHours(8);

    /// <summary>The safe maximum: above every published night (13.7 h) and below the 16 h night-session cap.</summary>
    public static readonly TimeSpan Maximum = TimeSpan.FromHours(14);

    /// <summary>The norms apply from this age (6 months): under it the cut-off stays <see cref="Default"/>.</summary>
    public const int NormFromAgeDays = 183;

    private readonly AgeNormSet? _norms;
    private readonly DateOnly? _birthDate;

    /// <summary>The 8-hour cut-off for every age (no norms or no birth date).</summary>
    public static readonly FeedGapLimit Fixed = new(null, null);

    public FeedGapLimit(AgeNormSet? norms, DateOnly? birthDate)
    {
        _norms = norms;
        _birthDate = birthDate;
    }

    /// <summary>The cut-off for a gap that starts on the local <paramref name="date"/>.</summary>
    public TimeSpan On(DateOnly date) =>
        _birthDate is { } birth ? For(_norms, date.DayNumber - birth.DayNumber) : Default;

    /// <summary>The cut-off at <paramref name="ageDays"/> completed days (<c>null</c> or negative: unknown age).</summary>
    public static TimeSpan For(AgeNormSet? norms, int? ageDays)
    {
        if (norms is null || ageDays is not { } age || age < NormFromAgeDays)
        {
            return Default;
        }

        var high = norms.PriorFor(AgeNormMetrics.LongestSleepHours, AgeNormPopulations.All, age)?.High
            ?? norms.PriorFor(AgeNormMetrics.NightSleepHours, AgeNormPopulations.All, age)?.High;
        return high is { } hours ? Clamp(TimeSpan.FromHours((double)hours)) : Default;
    }

    private static TimeSpan Clamp(TimeSpan value) =>
        value < Default ? Default : value > Maximum ? Maximum : value;
}
