using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.Tests.Predictions;

public sealed class CryCauseClassifierTests
{
    private static readonly EventTypeKey Feeding = BuiltInEventTypes.Feeding.Key;
    private static readonly EventTypeKey Sleep = BuiltInEventTypes.Sleep.Key;
    private static readonly EventTypeKey Diaper = BuiltInEventTypes.Diaper.Key;
    private static readonly EventTypeKey Fussy = BuiltInEventTypes.Fussy.Key;
    private static readonly EventTypeKey Bath = BuiltInEventTypes.Bath.Key;

    private static readonly DateTimeOffset Now = new(2025, 11, 15, 18, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly BirthDate = new(2025, 5, 15);
    private static readonly PredictionContext Context = new(BirthDate, Now);
    private static readonly PredictionOptions OptionsWithClassification = new() { CryCauseClassificationEnabled = true };
    private static readonly PredictionOptions OptionsWithoutClassification = new() { CryCauseClassificationEnabled = false };

    private static ObservedEvent CryEvent(DateTimeOffset time) =>
        new(Fussy, time, time.AddMinutes(10));

    private static ObservedEvent FeedingEvent(DateTimeOffset start, DateTimeOffset? end = null) =>
        new(Feeding, start, end ?? start.AddMinutes(20));

    private static ObservedEvent SleepEndEvent(DateTimeOffset endedAt) =>
        new(Sleep, endedAt.AddHours(-2), endedAt, Kind: "nap");

    private static ObservedEvent DirtyDiaperEvent(DateTimeOffset time) =>
        new(Diaper, time, null, Content: "DIRTY");

    // --- Kill switch and guard tests ---

    [Fact]
    public void Classify_ReturnsNull_WhenClassificationDisabled()
    {
        var cry = CryEvent(Now);
        var result = CryCauseClassifier.Classify([cry], cry, Context, OptionsWithoutClassification);

        Assert.Null(result);
    }

    [Fact]
    public void Classify_ReturnsNull_WhenCryConfirmedNotCrying()
    {
        var cry = new ObservedEvent(Fussy, Now, Now.AddMinutes(10), ConfirmedNotCrying: true);
        var result = CryCauseClassifier.Classify([cry], cry, Context, OptionsWithClassification);

        Assert.Null(result);
    }

    // --- Edge case: no prior events ---

    [Fact]
    public void Classify_ReturnsUnknownDominant_WhenNoPriorEvents()
    {
        var cry = CryEvent(Now);
        var result = CryCauseClassifier.Classify([cry], cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        Assert.True(result.Causes.Count > 0);
        // With no feeding, sleep or diaper history, hunger/overtired get low scores (0.2 each),
        // pre-poop gets 0.15, gas/overstimulation get 0. All below threshold except the low defaults.
        // Probabilities must sum to 1.0.
        var totalProb = result.Causes.Sum(c => c.Probability);
        Assert.Equal(1.0, totalProb, precision: 3);
    }

    // --- Hunger scoring ---

    [Fact]
    public void Classify_HungerScoresHigh_WhenGapExceedsExpectedInterval()
    {
        // Last feeding was 4 hours ago; default hunger gap is 3 hours.
        var lastFeed = FeedingEvent(Now.AddHours(-4));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastFeed, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var hunger = result.Causes.First(c => c.Cause == CryCause.Hunger);
        Assert.True(hunger.Probability > 0.1, $"Hunger probability should be significant but was {hunger.Probability}");
        Assert.Contains("exceeds", hunger.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Classify_HungerScoresLow_WhenRecentlyFed()
    {
        // Last feeding was 30 minutes ago; well within default 3-hour gap.
        var lastFeed = FeedingEvent(Now.AddMinutes(-30));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastFeed, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var hunger = result.Causes.FirstOrDefault(c => c.Cause == CryCause.Hunger);
        // Score should be low (ratio ~0.17, score ~0.06), likely below threshold and excluded.
        Assert.True(hunger is null || hunger.Probability < 0.15, $"Hunger probability should be low but was {hunger?.Probability}");
    }

    // --- Overtired scoring ---

    [Fact]
    public void Classify_OvertiredScoresHigh_WhenAwakeExceedsExpectedWindow()
    {
        // Last sleep ended 3 hours ago; default awake window is 2 hours.
        var lastSleepEnd = SleepEndEvent(Now.AddHours(-3));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastSleepEnd, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var overtired = result.Causes.First(c => c.Cause == CryCause.Overtired);
        Assert.True(overtired.Probability > 0.1, $"Overtired probability should be significant but was {overtired.Probability}");
        Assert.Contains("exceeding", overtired.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Classify_OvertiredScoresLow_WhenRecentlyWoke()
    {
        // Last sleep ended 30 minutes ago; well within default 2-hour awake window.
        var lastSleepEnd = SleepEndEvent(Now.AddMinutes(-30));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastSleepEnd, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var overtired = result.Causes.FirstOrDefault(c => c.Cause == CryCause.Overtired);
        Assert.True(overtired is null || overtired.Probability < 0.15, $"Overtired probability should be low but was {overtired?.Probability}");
    }

    // --- Gas post-feed scoring ---

    [Fact]
    public void Classify_GasPostFeedScoresHigh_WhenCryWithinGasWindow()
    {
        // Feeding ended 30 minutes ago (midpoint of 15-45 min window).
        var feeding = FeedingEvent(Now.AddMinutes(-50), Now.AddMinutes(-30));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { feeding, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var gas = result.Causes.First(c => c.Cause == CryCause.GasPostFeed);
        Assert.True(gas.Probability > 0.05, $"Gas probability should be non-trivial but was {gas.Probability}");
        Assert.Contains("gas window", gas.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Classify_GasPostFeedScoresZero_WhenNoRecentFeeding()
    {
        // Last feeding was 2 hours ago, outside the 15-45 min gas window.
        var feeding = FeedingEvent(Now.AddHours(-2));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { feeding, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var gas = result.Causes.FirstOrDefault(c => c.Cause == CryCause.GasPostFeed);
        Assert.True(gas is null || gas.Probability < 0.01, $"Gas probability should be zero or excluded but was {gas?.Probability}");
    }

    // --- Pre-poop discomfort scoring ---

    [Fact]
    public void Classify_PrePoopScoresHigh_WhenDirtyDiaperOverdue()
    {
        // Last dirty diaper was 10 hours ago; default interval is 6h, threshold = 6 * 1.5 = 9h.
        var lastDirty = DirtyDiaperEvent(Now.AddHours(-10));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastDirty, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var poop = result.Causes.First(c => c.Cause == CryCause.PrePoopDiscomfort);
        Assert.True(poop.Probability > 0.05, $"Pre-poop probability should be non-trivial but was {poop.Probability}");
        Assert.Contains("exceeding", poop.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Classify_PrePoopScoresLow_WhenRecentDirtyDiaper()
    {
        // Last dirty diaper was 2 hours ago; well within 9h threshold.
        var lastDirty = DirtyDiaperEvent(Now.AddHours(-2));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastDirty, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var poop = result.Causes.FirstOrDefault(c => c.Cause == CryCause.PrePoopDiscomfort);
        Assert.True(poop is null || poop.Probability < 0.01, $"Pre-poop probability should be zero or excluded but was {poop?.Probability}");
    }

    // --- Overstimulation scoring ---

    [Fact]
    public void Classify_OverstimulationScoresHigh_WhenEveningAndHighDensity()
    {
        // Evening (18:00 local, which is >= 17), with 8 events in last 2 hours (threshold is 6).
        var events = new List<ObservedEvent>();
        for (var i = 0; i < 8; i++)
        {
            events.Add(new ObservedEvent(Bath, Now.AddMinutes(-i * 15), null));
        }
        var cry = CryEvent(Now);
        events.Add(cry);

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var overstim = result.Causes.First(c => c.Cause == CryCause.Overstimulation);
        Assert.True(overstim.Probability > 0.05, $"Overstimulation probability should be non-trivial but was {overstim.Probability}");
        Assert.Contains("evening", overstim.Reason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Classify_OverstimulationScoresZero_WhenNotEvening()
    {
        // Morning context (10:00 UTC, offset zero => local hour 10, before 17).
        var morningContext = new PredictionContext(BirthDate, new DateTimeOffset(2025, 11, 15, 10, 0, 0, TimeSpan.Zero));
        var events = new List<ObservedEvent>();
        for (var i = 0; i < 10; i++)
        {
            events.Add(new ObservedEvent(Bath, morningContext.Now.AddMinutes(-i * 10), null));
        }
        var cry = CryEvent(morningContext.Now);
        events.Add(cry);

        var result = CryCauseClassifier.Classify(events, cry, morningContext, OptionsWithClassification);

        Assert.NotNull(result);
        var overstim = result.Causes.FirstOrDefault(c => c.Cause == CryCause.Overstimulation);
        Assert.True(overstim is null || overstim.Probability < 0.01, $"Overstimulation probability should be zero or excluded but was {overstim?.Probability}");
    }

    [Fact]
    public void Classify_OverstimulationScoresZero_WhenLowDensity()
    {
        // Evening but only 3 events in 2 hours (below threshold of 6).
        var events = new List<ObservedEvent>
        {
            new(Bath, Now.AddMinutes(-30), null),
            new(Bath, Now.AddMinutes(-60), null),
            new(Bath, Now.AddMinutes(-90), null),
        };
        var cry = CryEvent(Now);
        events.Add(cry);

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var overstim = result.Causes.FirstOrDefault(c => c.Cause == CryCause.Overstimulation);
        Assert.True(overstim is null || overstim.Probability < 0.01, $"Overstimulation probability should be zero or excluded but was {overstim?.Probability}");
    }

    // --- Probability normalization ---

    [Fact]
    public void Classify_ProbabilitiesSumToOne()
    {
        var lastFeed = FeedingEvent(Now.AddHours(-4));
        var lastSleepEnd = SleepEndEvent(Now.AddHours(-3));
        var lastDirty = DirtyDiaperEvent(Now.AddHours(-10));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastFeed, lastSleepEnd, lastDirty, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var totalProb = result.Causes.Sum(c => c.Probability);
        Assert.Equal(1.0, totalProb, precision: 3);
    }

    [Fact]
    public void Classify_CausesSortedByProbabilityDescending()
    {
        var lastFeed = FeedingEvent(Now.AddHours(-4));
        var lastSleepEnd = SleepEndEvent(Now.AddHours(-3));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastFeed, lastSleepEnd, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        for (var i = 1; i < result.Causes.Count; i++)
        {
            Assert.True(
                result.Causes[i - 1].Probability >= result.Causes[i].Probability,
                $"Causes not sorted descending at index {i}: {result.Causes[i - 1].Probability} < {result.Causes[i].Probability}");
        }
    }

    [Fact]
    public void Classify_AlwaysIncludesUnknown()
    {
        var cry = CryEvent(Now);
        var result = CryCauseClassifier.Classify([cry], cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        Assert.Contains(result.Causes, c => c.Cause == CryCause.Unknown);
    }

    // --- Multiple causes competing ---

    [Fact]
    public void Classify_MultipleCausesCompete_HungerAndOvertired()
    {
        // Both hungry (4h since feed) and overtired (3h awake).
        var lastFeed = FeedingEvent(Now.AddHours(-4));
        var lastSleepEnd = SleepEndEvent(Now.AddHours(-3));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastFeed, lastSleepEnd, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        var hunger = result.Causes.First(c => c.Cause == CryCause.Hunger);
        var overtired = result.Causes.First(c => c.Cause == CryCause.Overtired);
        // Both should have meaningful probability.
        Assert.True(hunger.Probability > 0.05, $"Hunger should compete but was {hunger.Probability}");
        Assert.True(overtired.Probability > 0.05, $"Overtired should compete but was {overtired.Probability}");
        // Sum still 1.0.
        Assert.Equal(1.0, result.Causes.Sum(c => c.Probability), precision: 3);
    }

    // --- TopCause helper ---

    [Fact]
    public void TopCause_ReturnsHighestProbabilityCause()
    {
        // Create a scenario where hunger dominates.
        var lastFeed = FeedingEvent(Now.AddHours(-6));
        var lastSleepEnd = SleepEndEvent(Now.AddMinutes(-30)); // recently woke
        var lastDirty = DirtyDiaperEvent(Now.AddMinutes(-30)); // recent diaper
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastFeed, lastSleepEnd, lastDirty, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification);

        Assert.NotNull(result);
        Assert.Equal(CryCause.Hunger, result.TopCause);
    }

    // --- Very young baby edge case ---

    [Fact]
    public void Classify_HandlesVeryYoungBaby_WithoutCrash()
    {
        var youngBirthDate = DateOnly.FromDateTime(Now.AddDays(-7).DateTime);
        var youngContext = new PredictionContext(youngBirthDate, Now);
        var cry = CryEvent(Now);

        var result = CryCauseClassifier.Classify([cry], cry, youngContext, OptionsWithClassification);

        Assert.NotNull(result);
        Assert.True(result.Causes.Count > 0);
        Assert.Equal(1.0, result.Causes.Sum(c => c.Probability), precision: 3);
    }

    // --- Custom CryCauseOptions ---

    [Fact]
    public void Classify_RespectsCustomOptions()
    {
        // Set a very short default hunger gap so even a recent feed triggers hunger.
        var customOpts = new CryCauseOptions { DefaultHungerGap = TimeSpan.FromMinutes(10) };
        var lastFeed = FeedingEvent(Now.AddMinutes(-20));
        var cry = CryEvent(Now);
        var events = new List<ObservedEvent> { lastFeed, cry };

        var result = CryCauseClassifier.Classify(events, cry, Context, OptionsWithClassification, cryOptions: customOpts);

        Assert.NotNull(result);
        var hunger = result.Causes.First(c => c.Cause == CryCause.Hunger);
        // With 10-min default gap and 20-min actual gap, ratio = 2.0, score = 2/3.
        Assert.True(hunger.Probability > 0.1, $"Hunger should score high with custom options but was {hunger.Probability}");
    }
}