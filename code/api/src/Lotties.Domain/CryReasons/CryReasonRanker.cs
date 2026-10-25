namespace Lotties.Domain.CryReasons;

/// <summary>
/// "Why is she crying?" (docs/design/27-cry-reasons.md): ranks what the log suggests and nothing else. A pure port of the
/// scoring half of the web's <c>rankCryReasons</c> (<c>code/web/src/now/cryReasons.ts</c>, <c>scoreCrySignals</c>): it reads
/// the signals already extracted from the baby's own events and orders a fixed list of everyday causes. It never
/// diagnoses, never names an illness and never suggests a dose or a treatment. The web and this class run the same vectors
/// (<c>code/web/src/now/cryReasonsVectors.json</c>), so they stay identical. While a sleep timer runs every cause is a
/// neutral <c>possible</c> with a <c>noData</c> fact: crying while logged asleep says the log is out of date, not why she cries.
/// </summary>
public static class CryReasonRanker
{
    private const double ComfortMargin = 0.05;
    private const int MillisecondsPerMinute = 60_000;
    private const double RoundingFactor = 1000;

    private static readonly CryCause[] Order = [CryCause.Hunger, CryCause.Sleepy, CryCause.Diaper, CryCause.Gas, CryCause.Comfort];

    public static CryReasonResult Rank(CrySignals signals, CryWeights? weights = null)
    {
        ArgumentNullException.ThrowIfNull(signals);
        var rules = weights ?? CryWeights.Default;
        var band = rules.For(signals.Band);
        var scored = signals.Asleep ? AllAsleep(rules) : Score(signals, rules, band);
        var comfortScore = Math.Min(band.Comfort, Math.Min(rules.LikelyFrom - ComfortMargin, rules.NoDataScore - ComfortMargin));
        var causes = Order
            .Select(cause => cause == CryCause.Comfort ? new CryCauseRank(cause, CryLevel.Possible, Round3(comfortScore), []) : Ranked(cause, scored[cause], rules))
            .Select((rank, index) => (Rank: rank, Index: index))
            .OrderByDescending(entry => entry.Rank.Score)
            .ThenBy(entry => entry.Index)
            .Select(entry => entry.Rank)
            .ToArray();
        return new CryReasonResult(causes, Enum.GetValues<CryRedFlag>());
    }

    private static Dictionary<CryCause, Scored> AllAsleep(CryWeights rules) => new()
    {
        [CryCause.Hunger] = NoData(rules, "asleep"),
        [CryCause.Sleepy] = NoData(rules, "asleep"),
        [CryCause.Diaper] = NoData(rules, "asleep"),
        [CryCause.Gas] = NoData(rules, "asleep"),
    };

    private static Dictionary<CryCause, Scored> Score(CrySignals signals, CryWeights rules, CryBandWeights band) => new()
    {
        [CryCause.Hunger] = Hunger(signals.Hunger, rules, band),
        [CryCause.Sleepy] = Sleepy(signals.Sleepy, rules, band),
        [CryCause.Diaper] = Diaper(signals.Diaper, rules, band),
        [CryCause.Gas] = Gas(signals.Gas, rules, band),
    };

    private static CryCauseRank Ranked(CryCause cause, Scored scored, CryWeights rules)
    {
        var rounded = Round3(scored.Score);
        return new CryCauseRank(cause, LevelOf(rounded, rules), rounded, scored.Facts);
    }

    private static Scored Hunger(CryHungerSignal hunger, CryWeights rules, CryBandWeights band)
    {
        if (!hunger.HasFeeds)
        {
            return NoData(rules, "noLog");
        }

        if (hunger.RunningMinutes is { } running)
        {
            return new Scored(rules.RunningFeedScore, [new CryFact { Kind = "feedingNow", Minutes = running }]);
        }

        var own = OwnGap(hunger, rules);
        var usual = own ?? hunger.NormGapMinutes ?? band.FeedGapMinutes;
        var gap = hunger.TopUpShare is { } share ? Rounded(usual * (1 - share)) : usual;
        var score = Ramp((double)hunger.SinceLastMinutes / gap, band.Hunger);
        var fresh = hunger.SinceLastFeedEndMs is { } sinceEnd && sinceEnd < rules.FreshFeedMinutes * MillisecondsPerMinute;
        return new Scored(
            fresh ? Math.Min(score, rules.FreshCap) : score,
            [new CryFact { Kind = "sinceLastFeed", Minutes = hunger.SinceLastMinutes, UsualGapMinutes = own, SmallerFeed = hunger.TopUpShare is null ? null : true }]);
    }

    private static int? OwnGap(CryHungerSignal hunger, CryWeights rules) =>
        hunger.RecentGapsMinutes.Count >= rules.MinimumFeedGaps ? Rounded(Median(hunger.RecentGapsMinutes)) : hunger.ServerGapMinutes;

    private static Scored Sleepy(CrySleepySignal sleepy, CryWeights rules, CryBandWeights band)
    {
        if (sleepy.Stretch is not { } stretch)
        {
            return NoData(rules, "noLog");
        }

        var score = Ramp((double)stretch.Minutes / (sleepy.WindowMinutes ?? band.WakeWindowMinutes), band.Sleepy);
        score += sleepy.Overtired ? band.OvertiredBoost : 0;
        var facts = new List<CryFact> { new() { Kind = "awakeFor", Minutes = stretch.Minutes, WindowMinutes = sleepy.WindowMinutes } };
        if (stretch.Night)
        {
            score = Math.Max(score, band.NightFloor);
            facts.Add(new CryFact { Kind = "nightTime" });
        }

        return new Scored(score, facts);
    }

    private static Scored Diaper(CryDiaperSignal diaper, CryWeights rules, CryBandWeights band)
    {
        if (diaper.SinceLastMinutes is not { } minutes)
        {
            return NoData(rules, "noLog");
        }

        var score = Ramp((double)minutes / (diaper.UsualWetGapMinutes ?? band.DiaperGapMinutes), band.Diaper);
        var facts = new List<CryFact> { new() { Kind = "sinceLastDiaper", Minutes = minutes, UsualGapMinutes = diaper.UsualWetGapMinutes } };
        if (minutes < rules.FreshDiaperMinutes)
        {
            return new Scored(Math.Min(score, rules.FreshCap), facts);
        }

        if (diaper.DirtyDue is { } due)
        {
            score += band.DirtyDueBoost;
            facts.Add(new CryFact { Kind = "dirtyDue", Signal = due.Signal, ExpectedAt = due.ExpectedAt });
        }

        return new Scored(minutes >= rules.StaleDiaperHours * 60 ? Math.Max(score, band.StaleFloor) : score, facts);
    }

    private static Scored Gas(CryGasSignal gas, CryWeights rules, CryBandWeights band)
    {
        var parts = new[] { PostFeedGas(gas, rules, band) }.OfType<Scored>().Concat(PatternGas(gas, rules, band)).ToArray();
        var hasPattern = parts.Any(part => part.Facts.Any(fact => fact.Kind == "bellyPattern"));
        if (!gas.HasFeeds && !hasPattern)
        {
            return NoData(rules, "noLog");
        }

        var score = parts.Sum(part => part.Score) + band.Gas.Base;
        return new Scored(Math.Min(score, band.Gas.Max), parts.SelectMany(part => part.Facts).ToArray());
    }

    private static Scored? PostFeedGas(CryGasSignal gas, CryWeights rules, CryBandWeights band)
    {
        if (gas.SinceMilkFeedEndMs is not { } sinceMs || sinceMs > rules.PostFeedMinutes * MillisecondsPerMinute)
        {
            return null;
        }

        var minutesSinceFeed = (int)Math.Floor(sinceMs / MillisecondsPerMinute);
        return gas.ReliefSinceFeed
            ? new Scored(band.Gas.PostFeedRelieved, [new CryFact { Kind = "reliefAfterFeed", MinutesSinceFeed = minutesSinceFeed }])
            : new Scored(band.Gas.PostFeed, [new CryFact { Kind = "recentFeedNoBurp", MinutesSinceFeed = minutesSinceFeed }]);
    }

    private static IEnumerable<Scored> PatternGas(CryGasSignal gas, CryWeights rules, CryBandWeights band)
    {
        if (gas.BellyPatternClock is { } belly)
        {
            yield return new Scored(band.Gas.BellyPattern, [new CryFact { Kind = "bellyPattern", TypicalClock = belly }]);
        }

        if (gas.FussyPatternClock is { } fussy)
        {
            yield return new Scored(band.Gas.EveningPattern, [new CryFact { Kind = "eveningFussy", TypicalClock = fussy }]);
        }
        else if (band.Gas.EveningGeneric > 0 && gas.LocalHour >= rules.EveningFromHour && gas.LocalHour < rules.EveningUntilHour)
        {
            yield return new Scored(band.Gas.EveningGeneric, [new CryFact { Kind = "eveningFussy" }]);
        }
    }

    private static Scored NoData(CryWeights rules, string reason) =>
        new(rules.NoDataScore, [new CryFact { Kind = "noData", Reason = reason }]);

    private static CryLevel LevelOf(double score, CryWeights rules) => score switch
    {
        _ when score >= rules.LikelyFrom => CryLevel.Likely,
        _ when score >= rules.PossibleFrom => CryLevel.Possible,
        _ => CryLevel.Unlikely,
    };

    /// <summary>The floor until <c>RampFrom</c>, linear up to the max at <c>RampTo</c>, the max after.</summary>
    private static double Ramp(double ratio, CryRamp ramp)
    {
        var t = Math.Clamp((ratio - ramp.RampFrom) / (ramp.RampTo - ramp.RampFrom), 0, 1);
        return ramp.Floor + ((ramp.Max - ramp.Floor) * t);
    }

    private static double Median(IReadOnlyList<double> values)
    {
        var sorted = values.Order().ToArray();
        var middle = sorted.Length / 2;
        return sorted.Length % 2 == 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    private static int Rounded(double value) => (int)Math.Round(value, MidpointRounding.AwayFromZero);

    private static double Round3(double value) => Math.Round(Math.Clamp(value, 0, 1) * RoundingFactor, MidpointRounding.AwayFromZero) / RoundingFactor;

    private sealed record Scored(double Score, IReadOnlyList<CryFact> Facts);
}
