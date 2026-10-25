using System.Text.Json;
using Lotties.Application.AgeNorms;
using Lotties.Domain.AgeNorms;
using Lotties.Domain.Assistants;
using Lotties.Domain.Clinical;
using Lotties.Domain.CryReasons;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;

namespace Lotties.Application.Assistants;

/// <summary>
/// "Why is she crying?" by voice (docs/design/27-cry-reasons.md, docs/design/32-assistants.md): reads the baby's own log into
/// the signals the web's ranking reads (<see cref="CrySignals"/>) and orders the everyday causes with the same pure scoring
/// (<see cref="CryReasonRanker"/>, shared vectors with <c>code/web/src/now/cryReasons.ts</c>). The extraction here is the
/// server's reading of the same log: the awake stretch and night rule from the sleep log (<see cref="AssistantSleepState"/>),
/// her feed gaps, the prediction's feed gap, the published norm in the first four weeks, a smaller last bottle
/// (<see cref="CryTopUp"/>), the wake window and overtired heads-up, the diaper gaps and a dirty diaper due, the belly pain and
/// fussy windows. It never diagnoses, names an illness, soothes or doses; every answer carries the red flags.
/// </summary>
internal sealed class AssistantCryReasons(
    IPredictionHistoryRepository history,
    IClinicalEventRepository clinicalEvents,
    IAgeNormsProvider ageNorms,
    PredictionOptions options)
{
    /// <summary>The most causes an answer tells.</summary>
    public const int MaxCauses = 3;

    /// <summary>Published feed norms seed the default gap only in the first four weeks (the web's <c>CRY_NORM_MAX_AGE_DAYS</c>).</summary>
    private const int NormMaxAgeDays = 28;

    private const string SleepKey = "sleep";
    private const string FeedingKey = "feeding";
    private const int RecentTake = 300;
    private const int MinimumServerGap = 30;
    private const int MaximumServerGap = 720;
    private const int MaximumWakeWindowMinutes = 12 * 60;

    private static readonly TimeSpan SleepLookback = TimeSpan.FromDays(30);
    private static readonly TimeSpan FeedingLookback = TimeSpan.FromDays(14);
    private static readonly string[] ReliefKeys = ["belly_massage", "burp", "burping"];

    public async Task<AssistantResult> ReadAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var stored = await history.LoadAsync(subject.Baby.Id, subject.Now - options.LookBack, cancellationToken);
        var sleepEvents = await EventsAsync(subject, SleepKey, SleepLookback, cancellationToken);
        var feedings = await EventsAsync(subject, FeedingKey, FeedingLookback, cancellationToken);
        var sleepState = AssistantSleepState.Of(sleepEvents, subject.Now);
        var observed = stored?.Events ?? [];
        var signals = Signals(subject, observed, sleepEvents, feedings, sleepState);
        return Answer(subject, CryReasonRanker.Rank(signals), sleepState.Phase == AssistantSleepPhase.Asleep);
    }

    private static AssistantResult Answer(AssistantSubject subject, CryReasonResult ranking, bool asleep)
    {
        var causes = ranking.Causes
            .Where(rank => rank.Cause != CryCause.Comfort && rank.Level != CryLevel.Unlikely)
            .Select(rank => new AssistantCryCause(rank.Cause, rank.Level, rank.Facts.Where(fact => fact.Kind != "noData").ToArray()))
            .Where(cause => cause.Facts.Count > 0)
            .Take(MaxCauses)
            .ToArray();
        var flags = ranking.RedFlags.Select(flag => JsonNamingPolicy.SnakeCaseLower.ConvertName(flag.ToString())).ToArray();
        return causes.Length == 0
            ? subject.Result(AssistantResultCode.CryNoData) with { RedFlags = flags, Running = asleep ? true : null }
            : subject.Result(AssistantResultCode.CryReasons) with { CryCauses = causes, RedFlags = flags };
    }

    private CrySignals Signals(
        AssistantSubject subject,
        IReadOnlyList<ObservedEvent> observed,
        IReadOnlyList<Event> sleepEvents,
        IReadOnlyList<Event> feedings,
        AssistantSleepState sleepState)
    {
        var clock = subject.Clock;
        var localToday = clock.DateOf(subject.Now);
        var prediction = Prediction(observed, subject);
        var wake = WakeWindows.Measure(observed, subject.Now, clock, WakeWindowOptions.Default, options);
        return new CrySignals(
            CryAgeBands.At(subject.Baby.BirthDate, localToday),
            sleepState.Phase == AssistantSleepPhase.Asleep && sleepState.RunningNightWakingSince is null,
            Hunger(subject, feedings, prediction, localToday),
            Sleepy(subject, sleepEvents, sleepState, wake),
            Diaper(subject, observed),
            Gas(subject, observed, feedings));
    }

    private PredictionSet Prediction(IReadOnlyList<ObservedEvent> observed, AssistantSubject subject) =>
        PredictionEngine.Predict(observed, new PredictionContext(subject.Baby.BirthDate, subject.LocalNow), options);

    private CryHungerSignal Hunger(AssistantSubject subject, IReadOnlyList<Event> feedings, PredictionSet prediction, DateOnly localToday)
    {
        var feeds = feedings.Where(stored => !stored.IsDeleted && stored.StartedAt <= subject.Now).ToArray();
        var running = feeds.Where(stored => stored.EndedAt is null).MaxBy(stored => stored.StartedAt);
        var latest = feeds.MaxBy(stored => stored.StartedAt);
        var lastEnd = feeds.Where(stored => stored.EndedAt is { } end && end <= subject.Now).Select(stored => stored.EndedAt).Max();
        return new CryHungerSignal(
            feeds.Length > 0,
            running is null ? null : WholeMinutes(subject.Now - running.StartedAt),
            latest is null ? 0 : WholeMinutes(subject.Now - latest.StartedAt),
            CryFeedGaps.Between(feeds.Select(stored => stored.StartedAt), subject.Now).Select(gap => gap.Minutes).ToArray(),
            ServerFeedGap(prediction),
            NormFeedGap(subject, feeds, localToday),
            CryTopUp.Share(feeds, subject.Now, subject.Zone),
            lastEnd is { } end ? (subject.Now - end).TotalMilliseconds : null);
    }

    /// <summary>The usual gap of the server's feeding prediction when plausible (30 minutes to 12 hours), the web's <c>serverFeedGapMinutes</c>.</summary>
    private static int? ServerFeedGap(PredictionSet prediction)
    {
        var gap = prediction.Predictions.FirstOrDefault(item => item.TypeKey == BuiltInEventTypes.Feeding.Key)?.Reason.MedianGap;
        var minutes = gap is { } span ? (int)Math.Round(span.TotalMinutes, MidpointRounding.AwayFromZero) : (int?)null;
        return minutes is >= MinimumServerGap and <= MaximumServerGap ? minutes : null;
    }

    /// <summary>
    /// The published usual gap for her age and milk, only in the first four weeks and only from a norm usable as a prior
    /// (the web's <c>normFeedGapMinutes</c>): the published gap when it has a central value, else 24 hours over the
    /// published feeds a day.
    /// </summary>
    private int? NormFeedGap(AssistantSubject subject, IReadOnlyList<Event> feeds, DateOnly localToday)
    {
        var ageDays = localToday.DayNumber - subject.Baby.BirthDate.DayNumber;
        if (ageDays < 0 || ageDays >= NormMaxAgeDays || MilkPopulation(feeds) is not { } population)
        {
            return null;
        }

        var gap = ageNorms.Norms.PriorFor(AgeNormMetrics.FeedGapMinutes, population, ageDays)?.Typical;
        if (gap is > 0)
        {
            return (int)Math.Round(gap.Value, MidpointRounding.AwayFromZero);
        }

        var perDay = ageNorms.Norms.PriorFor(AgeNormMetrics.FeedsPer24h, population, ageDays)?.Typical;
        return perDay is > 0 ? (int)Math.Round(24 * 60 / perDay.Value, MidpointRounding.AwayFromZero) : null;
    }

    /// <summary>The population of her milk feeds: breastfed when every milk feed was breast milk, formula when every one was formula, else <c>null</c>.</summary>
    private static string? MilkPopulation(IReadOnlyList<Event> feeds)
    {
        var kinds = feeds
            .Select(AssistantEventFacts.ReadFeed)
            .Where(feed => feed.Method != FeedMethod.Solid)
            .Select(MilkOf)
            .Distinct()
            .ToArray();
        return kinds.Length == 1 ? kinds[0] : null;
    }

    private static string? MilkOf(FeedFact feed) => feed.Method switch
    {
        FeedMethod.Breast => AgeNormPopulations.Breastfed,
        FeedMethod.Bottle when feed.BottleKind == BottleKind.BreastMilk => AgeNormPopulations.Breastfed,
        FeedMethod.Bottle when feed.BottleKind == BottleKind.Formula || !string.IsNullOrWhiteSpace(feed.FormulaName) => AgeNormPopulations.Formula,
        _ => null,
    };

    private CrySleepySignal Sleepy(AssistantSubject subject, IReadOnlyList<Event> sleepEvents, AssistantSleepState state, WakeWindow? wake)
    {
        var stretch = AwakeStretch(subject, sleepEvents, state);
        var limit = wake is { } window && window.Limit > TimeSpan.Zero && window.Limit.TotalMinutes <= MaximumWakeWindowMinutes ? (int?)RoundedMinutes(window.Limit) : null;
        return new CrySleepySignal(stretch, limit, stretch is not null && IsOvertired(state, wake, subject.Now));
    }

    /// <summary>The awake stretch to judge, or <c>null</c> when the state is unknown or she sleeps: a night waking inside a sleep counts as the stretch.</summary>
    private static CryAwakeStretch? AwakeStretch(AssistantSubject subject, IReadOnlyList<Event> sleepEvents, AssistantSleepState state) => state switch
    {
        { Phase: AssistantSleepPhase.Asleep, RunningNightWakingSince: { } since } => new CryAwakeStretch(WholeMinutes(subject.Now - since), true),
        { Phase: AssistantSleepPhase.Awake, Since: { } since } => new CryAwakeStretch(
            WholeMinutes(subject.Now - since),
            state.NightWakingSinceWake || AssistantEventFacts.SleepKindAt(sleepEvents, subject.Now, subject.Zone) == SleepKinds.Night),
        _ => null,
    };

    /// <summary>The overtired heads-up shows from the lead before the usual limit until the grace after it, while she is awake and was not up in the night.</summary>
    private static bool IsOvertired(AssistantSleepState state, WakeWindow? wake, DateTimeOffset now)
    {
        if (wake is null || state.Phase != AssistantSleepPhase.Awake || state.NightWakingSinceWake || state.Since is not { } since)
        {
            return false;
        }

        var awake = now - since;
        var rules = WakeWindowOptions.Default;
        return awake >= wake.Limit - rules.Lead && awake < wake.Limit + rules.Grace;
    }

    private static CryDiaperSignal Diaper(AssistantSubject subject, IReadOnlyList<ObservedEvent> observed)
    {
        var rules = DiaperPredictionOptions.Default;
        var diapers = observed.Where(item => item.TypeKey == rules.DiaperTypeKey && item.StartedAt <= subject.Now).ToArray();
        if (diapers.Length == 0)
        {
            return new CryDiaperSignal(null, null, null);
        }

        var prediction = DiaperPredictions.Predict(observed, subject.Now, rules);
        var usual = prediction.Wet is { } wet ? RoundedMinutes(wet.MedianGap) : (int?)null;
        return new CryDiaperSignal(WholeMinutes(subject.Now - diapers.Max(item => item.StartedAt)), usual, DirtyDue(prediction, subject.Now, rules));
    }

    /// <summary>The dirty-diaper estimate when now is from the card's lead before the expected time until its grace after it (the web's <c>dirtySuggestion</c> timing).</summary>
    private static CryDirtyDue? DirtyDue(DiaperPrediction prediction, DateTimeOffset now, DiaperPredictionOptions rules)
    {
        if (prediction.DirtyExpectation(now) is not { } expectation)
        {
            return null;
        }

        var expected = expectation.Window.Expected;
        var showing = now >= expected - rules.CardLead && now < expected + rules.CardGrace;
        return showing ? new CryDirtyDue(expectation.Signal == DiaperSignal.DirtyAfterFeed ? "afterFeed" : "gap", expected.ToUniversalTime()) : null;
    }

    private CryGasSignal Gas(AssistantSubject subject, IReadOnlyList<ObservedEvent> observed, IReadOnlyList<Event> feedings)
    {
        var clock = subject.Clock;
        var milk = LatestMilkFeed(feedings, subject.Now);
        var relief = observed.Where(item => ReliefKeys.Contains(item.TypeKey.Value) && item.StartedAt <= subject.Now).ToArray();
        return new CryGasSignal(
            feedings.Any(stored => !stored.IsDeleted && stored.StartedAt <= subject.Now),
            milk?.EndedAt is { } end ? (subject.Now - end).TotalMilliseconds : null,
            milk is not null && ReliefSince(relief, milk.StartedAt),
            BellyClock(observed, relief, subject, clock),
            FussyClock(observed, subject, clock),
            clock.ToLocal(subject.Now).Hour);
    }

    /// <summary>The latest finished milk feed (breast, bottle or no method; solids excluded).</summary>
    private static Event? LatestMilkFeed(IReadOnlyList<Event> feedings, DateTimeOffset now) =>
        feedings
            .Where(stored => !stored.IsDeleted && stored.EndedAt is { } end && end <= now && AssistantEventFacts.ReadFeed(stored).Method != FeedMethod.Solid)
            .MaxBy(stored => stored.EndedAt);

    /// <summary>A burp or belly massage that started at or after <paramref name="from"/>, or one still running.</summary>
    private static bool ReliefSince(IEnumerable<ObservedEvent> relief, DateTimeOffset from) =>
        relief.Any(item => item.StartedAt >= from || item.EndedAt is null);

    private static string? BellyClock(IReadOnlyList<ObservedEvent> observed, IReadOnlyList<ObservedEvent> relief, AssistantSubject subject, LocalClock clock)
    {
        var pattern = BellyPainPatterns.Detect(observed, subject.Now, clock);
        var window = pattern is null ? null : WindowAround(pattern, BellyPainPatterns.Lead, subject.Now, clock);
        return pattern is not null && window is { } open && !ReliefSince(relief, clock.ToInstant(open.Start - BellyPainPatterns.Lead))
            ? Clock(pattern.Typical)
            : null;
    }

    private static string? FussyClock(IReadOnlyList<ObservedEvent> observed, AssistantSubject subject, LocalClock clock)
    {
        var pattern = FussyPatterns.Detect(observed, subject.Now, clock);
        return pattern is not null && WindowAround(pattern, FussyPatterns.Lead, subject.Now, clock) is not null ? Clock(pattern.Typical) : null;
    }

    /// <summary>The occurrence whose suggestion time holds now (from the window start minus the lead until the window ends), among the windows starting yesterday, today and tomorrow.</summary>
    private static PatternWindow? WindowAround(TimeOfDayPattern pattern, TimeSpan lead, DateTimeOffset now, LocalClock clock)
    {
        var localNow = clock.ToLocal(now);
        var today = clock.DateOf(now);
        return new[] { -1, 0, 1 }
            .Select(offset => pattern.WindowStartingOn(today.AddDays(offset)))
            .FirstOrDefault(window => window.Start - lead <= localNow && localNow < window.End);
    }

    private static string Clock(TimeOnly time) => time.ToString("HH:mm", System.Globalization.CultureInfo.InvariantCulture);

    private async Task<IReadOnlyList<Event>> EventsAsync(AssistantSubject subject, string typeKey, TimeSpan lookback, CancellationToken cancellationToken)
    {
        var newest = await clinicalEvents.ListNewestByTypesAsync(subject.Baby.Id, [typeKey], subject.Now - lookback, subject.Now + Event.MaxClientClockSkew, RecentTake, cancellationToken);
        return newest.Select(typed => typed.Event).ToArray();
    }

    private static int RoundedMinutes(TimeSpan span) => (int)Math.Round(span.TotalMinutes, MidpointRounding.AwayFromZero);

    private static int WholeMinutes(TimeSpan span) => (int)Math.Max(0, Math.Floor(span.TotalMinutes));
}
