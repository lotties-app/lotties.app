using System.Text.Json;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
using Lotties.Domain.Rhythm;

namespace Lotties.Domain.Tests.Rhythm;

/// <summary>
/// Synthetic babies only (docs/design/48-baby-rhythm.md). Local time is São Paulo (-03:00) unless a test says otherwise;
/// now is 2026-01-29 15:00, so the window is the evenings and days 2026-01-01 to 2026-01-28.
/// </summary>
public sealed class BabyRhythmTests
{
    private static readonly TimeSpan Offset = TimeSpan.FromHours(-3);
    private static readonly LocalClock SaoPaulo = LocalClock.WithOffset(Offset);
    private static readonly DateTimeOffset Now = Local(29, 15);
    private static readonly EventTypeKey Sleep = BuiltInEventTypes.Sleep.Key;
    private static readonly EventTypeKey Feeding = BuiltInEventTypes.Feeding.Key;
    private static readonly EventTypeKey Diaper = BuiltInEventTypes.Diaper.Key;
    private static readonly EventTypeKey Fussy = BuiltInEventTypes.Fussy.Key;

    /// <summary>A São Paulo wall-clock time on 2026-01-<paramref name="day"/> (hours past 23 and days past 31 roll over).</summary>
    private static DateTimeOffset Local(int day, int hour, int minute = 0) =>
        new DateTimeOffset(2026, 1, 1, 0, 0, 0, Offset).AddDays(day - 1).AddHours(hour).AddMinutes(minute);

    private static ObservedEvent Marker(string kind, DateTimeOffset at) => new(Sleep, at, at, kind);

    private static ObservedEvent Logged(string kind, DateTimeOffset start, DateTimeOffset? end) => new(Sleep, start, end, kind);

    private static ObservedEvent Feed(DateTimeOffset at) => new(Feeding, at, at);

    private static ObservedEvent DiaperChange(DateTimeOffset at, string content) => new(Diaper, at, at, Content: content);

    /// <summary>Bed time at <paramref name="hour"/>:<paramref name="minute"/> on evening <paramref name="evening"/>, woke up <paramref name="minutes"/> later.</summary>
    private static IEnumerable<ObservedEvent> Night(int evening, int hour, int minute, int minutes)
    {
        var bedTime = Local(evening, hour, minute);
        return [Marker(SleepKinds.BedTime, bedTime), Marker(SleepKinds.WokeUp, bedTime.AddMinutes(minutes))];
    }

    /// <summary>
    /// The regular baby: bed 20:00 and up 06:30 every evening (1 to 28), naps 09:00-10:00 and 13:00-14:30 on days 2 to 28,
    /// a feed every 3 hours from 01:00 on the 1st to 22:00 on the 28th (8 a day).
    /// </summary>
    private static List<ObservedEvent> RegularBaby()
    {
        var nights = Enumerable.Range(1, 28).SelectMany(evening => Night(evening, 20, 0, 630));
        var naps = Enumerable.Range(2, 27).SelectMany(day => new[]
        {
            Logged(SleepKinds.Nap, Local(day, 9), Local(day, 10)),
            Logged(SleepKinds.Nap, Local(day, 13), Local(day, 14, 30)),
        });
        var feeds = Enumerable.Range(0, 28 * 8).Select(index => Feed(Local(1, 1).AddHours(3 * index)));
        return [.. nights, .. naps, .. feeds];
    }

    /// <summary>
    /// 28 nights at 20:00: odd evenings have 3 feeds in the 4 hours before bed (17:00, 18:00, 19:00) and last
    /// <paramref name="oddMinutes"/>, even evenings 1 feed (19:00) and last <paramref name="evenMinutes"/>.
    /// </summary>
    private static List<ObservedEvent> EveningFeedBaby(Func<int, int> oddMinutes, Func<int, int> evenMinutes) =>
        Enumerable.Range(1, 28)
            .SelectMany(evening => evening % 2 == 1
                ? Night(evening, 20, 0, oddMinutes(evening)).Concat([Feed(Local(evening, 17)), Feed(Local(evening, 18)), Feed(Local(evening, 19))])
                : Night(evening, 20, 0, evenMinutes(evening)).Append(Feed(Local(evening, 19))))
            .ToList();

    private static RhythmMeasurement Measure(IEnumerable<ObservedEvent> events, DateTimeOffset? now = null, LocalClock? clock = null) =>
        BabyRhythm.Measure(events, now ?? Now, clock ?? SaoPaulo);

    private static string Json(RhythmMeasurement measurement) => JsonSerializer.Serialize(measurement);

    [Fact]
    public void LoadSince_IsTheLocalStartOfTheDayBeforeTheWindow()
    {
        Assert.Equal(new DateTimeOffset(2025, 12, 31, 0, 0, 0, Offset), BabyRhythm.LoadSince(Now, SaoPaulo));
    }

    [Fact]
    public void Measure_RegularBaby_GivesTheUsualClocksAndLengths()
    {
        var rhythm = Measure(RegularBaby());

        Assert.Equal((new DateOnly(2026, 1, 1), new DateOnly(2026, 1, 28), 28), (rhythm.FirstDay, rhythm.LastDay, rhythm.Nights.Count));
        Assert.Equal(new ClockSummary(RhythmStatus.Ok, new TimeOnly(20, 0), TimeSpan.Zero, 28), rhythm.BedTime);
        Assert.Equal(new ClockSummary(RhythmStatus.Ok, new TimeOnly(6, 30), TimeSpan.Zero, 28), rhythm.WakeUp);
        var tenAndAHalfHours = TimeSpan.FromMinutes(630);
        Assert.Equal(new DurationSummary(RhythmStatus.Ok, 28, tenAndAHalfHours, tenAndAHalfHours, tenAndAHalfHours), rhythm.NightLength);
        Assert.Equal(new DurationSummary(RhythmStatus.Ok, 28, tenAndAHalfHours, tenAndAHalfHours, tenAndAHalfHours), rhythm.LongestStretch);
        Assert.Equal(new DurationSummary(RhythmStatus.Ok, 28, tenAndAHalfHours, tenAndAHalfHours, tenAndAHalfHours), rhythm.FirstStretch);
    }

    [Fact]
    public void Measure_RegularBaby_CountsNapsAndFeedsPerDayAndFindsTheUsualNapStarts()
    {
        var rhythm = Measure(RegularBaby());

        Assert.Equal(new CountSummary(RhythmStatus.Ok, 27, 2, 2, 2), rhythm.Naps.PerDay);
        Assert.Equal([new TimeOnly(9, 0), new TimeOnly(13, 0)], rhythm.Naps.UsualStarts.Select(pattern => pattern.Typical));
        Assert.All(rhythm.Naps.UsualStarts, pattern => Assert.Equal((13, 13, TimeSpan.Zero), (pattern.Days.Count, pattern.EventDayCount, pattern.Spread)));
        Assert.Equal(new CountSummary(RhythmStatus.Ok, 28, 8, 8, 8), rhythm.Feeds.PerDay);
        var threeHours = TimeSpan.FromHours(3);
        Assert.Equal(new DurationSummary(RhythmStatus.Ok, 223, threeHours, threeHours, threeHours), rhythm.Feeds.Gap);
    }

    [Fact]
    public void Measure_RegularBaby_EveryNightInOneGroup_AssociationsLackData()
    {
        var rhythm = Measure(RegularBaby());

        var feeds = rhythm.Associations[0];
        Assert.Equal((RhythmFactor.EveningFeeds, (int?)2), (feeds.Factor, feeds.Threshold));
        Assert.Equal([RhythmOutcome.NightLength, RhythmOutcome.LongestStretch, RhythmOutcome.FirstStretch], feeds.Outcomes.Select(outcome => outcome.Outcome));
        Assert.All(feeds.Outcomes, outcome => Assert.Equal(new AssociationOutcome(outcome.Outcome, RhythmStatus.NotEnoughData, 28, 0, null, null, null, TimeSpan.Zero), outcome));
        var dirty = rhythm.Associations[1];
        Assert.Equal((RhythmFactor.DirtyDiaperDay, (int?)null), (dirty.Factor, dirty.Threshold));
        Assert.All(dirty.Outcomes, outcome => Assert.Equal(new AssociationOutcome(outcome.Outcome, RhythmStatus.NotEnoughData, 0, 0, null, null, null, null), outcome));
    }

    [Fact]
    public void Measure_IrregularBedTimes_VaryWithoutAUsualTime()
    {
        int[] bedHours = [18, 21, 24, 22, 19, 25, 23];
        var events = Enumerable.Range(1, 21).SelectMany(evening => Night(evening, bedHours[evening % bedHours.Length], 0, 600));

        var rhythm = Measure(events);

        Assert.Equal(21, rhythm.Nights.Count);
        Assert.Equal((RhythmStatus.Varies, (TimeOnly?)null, 21), (rhythm.BedTime.Status, rhythm.BedTime.Usual, rhythm.BedTime.Nights));
        Assert.True(rhythm.BedTime.Spread > TimeSpan.FromMinutes(90));
        Assert.Equal(RhythmStatus.Ok, rhythm.NightLength.Status);
    }

    [Fact]
    public void Measure_FourNights_NothingIsGuessed()
    {
        var events = Enumerable.Range(25, 4).SelectMany(evening => Night(evening, 20, 0, 600))
            .Append(Feed(Local(27, 8)))
            .Append(Feed(Local(27, 11)));

        var rhythm = Measure(events);

        Assert.Equal(new ClockSummary(RhythmStatus.NotEnoughData, null, null, 4), rhythm.BedTime);
        Assert.Equal(new ClockSummary(RhythmStatus.NotEnoughData, null, null, 4), rhythm.WakeUp);
        Assert.Equal(new DurationSummary(RhythmStatus.NotEnoughData, 4, null, null, null), rhythm.NightLength);
        Assert.Equal(new DurationSummary(RhythmStatus.NotEnoughData, 4, null, null, null), rhythm.LongestStretch);
        Assert.Equal(new CountSummary(RhythmStatus.NotEnoughData, 3, null, null, null), rhythm.Naps.PerDay);
        Assert.Empty(rhythm.Naps.UsualStarts);
        Assert.Equal(new CountSummary(RhythmStatus.NotEnoughData, 1, null, null, null), rhythm.Feeds.PerDay);
        Assert.Equal(new DurationSummary(RhythmStatus.NotEnoughData, 1, null, null, null), rhythm.Feeds.Gap);
    }

    [Fact]
    public void Measure_NoEvents_EveryMetricLacksData()
    {
        var rhythm = Measure([]);

        Assert.Empty(rhythm.Nights);
        Assert.Equal(RhythmStatus.NotEnoughData, rhythm.BedTime.Status);
        Assert.Equal(new CountSummary(RhythmStatus.NotEnoughData, 0, null, null, null), rhythm.Feeds.PerDay);
        Assert.Equal(2, rhythm.Associations.Count);
        Assert.All(rhythm.Associations.SelectMany(association => association.Outcomes), outcome => Assert.Equal((RhythmStatus.NotEnoughData, 0, 0, (TimeSpan?)null), (outcome.Status, outcome.NightsWith, outcome.NightsWithout, outcome.Spread)));
    }

    [Fact]
    public void Measure_BedTimesAroundMidnight_WrapOnTheClockAndStayOnTheirEvening()
    {
        var events = Enumerable.Range(1, 10).SelectMany(evening => evening % 2 == 0
            ? Night(evening, 23, 40, 500)
            : Night(evening + 1, 0, 20, 460));

        var rhythm = Measure(events);

        Assert.Equal(Enumerable.Range(1, 10).Select(day => new DateOnly(2026, 1, day)), rhythm.Nights.Select(night => night.Evening));
        Assert.Equal(new ClockSummary(RhythmStatus.Ok, new TimeOnly(0, 0), TimeSpan.FromMinutes(20), 10), rhythm.BedTime);
        Assert.Equal(new TimeOnly(8, 0), rhythm.WakeUp.Usual);
    }

    [Fact]
    public void Measure_DaylightSavingNight_IsItsRealLengthAndTheClocksStayPut()
    {
        var newYork = LocalClock.InZone(TimeZoneInfo.FindSystemTimeZoneById("America/New_York"));
        DateTimeOffset At(int day, int hour, int minute = 0) => newYork.ToInstant(new DateTime(2026, 3, day, hour, minute, 0));
        var events = Enumerable.Range(1, 10).SelectMany(evening => new[]
        {
            Marker(SleepKinds.BedTime, At(evening, 20)),
            Marker(SleepKinds.WokeUp, At(evening + 1, 6, 30)),
        }).ToArray();

        var inZone = BabyRhythm.Measure(events, At(12, 12), newYork);
        var fixedOffset = BabyRhythm.Measure(events, At(12, 12), LocalClock.WithOffset(TimeSpan.FromHours(-5)));

        Assert.Equal(10, inZone.Nights.Count);
        Assert.Equal(TimeSpan.FromMinutes(570), Assert.Single(inZone.Nights, night => night.Evening == new DateOnly(2026, 3, 7)).Length);
        Assert.All(inZone.Nights.Where(night => night.Evening != new DateOnly(2026, 3, 7)), night => Assert.Equal(TimeSpan.FromMinutes(630), night.Length));
        Assert.Equal(new ClockSummary(RhythmStatus.Ok, new TimeOnly(20, 0), TimeSpan.Zero, 10), inZone.BedTime);
        Assert.Equal(new ClockSummary(RhythmStatus.Ok, new TimeOnly(6, 30), TimeSpan.Zero, 10), inZone.WakeUp);
        Assert.Equal((TimeSpan.FromMinutes(630), TimeSpan.FromMinutes(630)), (inZone.NightLength.Median!.Value, inZone.NightLength.P25!.Value));
        Assert.True(fixedOffset.WakeUp.Spread > TimeSpan.Zero);
    }

    [Fact]
    public void Measure_NightWakings_CutTheNightIntoStretches()
    {
        var events = Enumerable.Range(1, 5).SelectMany(evening => Night(evening, 20, 0, 600).Concat(
        [
            Logged(SleepKinds.NightWaking, Local(evening, 23), Local(evening, 23, 30)),
            Logged(SleepKinds.NightWaking, Local(evening + 1, 3), Local(evening + 1, 3, 20)),
        ]));

        var rhythm = Measure(events);

        Assert.All(rhythm.Nights, night => Assert.Equal((600, 210, 180), ((int)night.Length.TotalMinutes, (int)night.LongestStretch.TotalMinutes, (int)night.FirstStretch.TotalMinutes)));
        Assert.Equal(TimeSpan.FromMinutes(210), rhythm.LongestStretch.Median);
        Assert.Equal(TimeSpan.FromMinutes(180), rhythm.FirstStretch.Median);
    }

    [Fact]
    public void Measure_TwoNightTimersOfOneEvening_AreOneNightWithTheGapAsAWaking()
    {
        var events = Enumerable.Range(1, 5).SelectMany(evening => new[]
        {
            Logged(SleepKinds.Night, Local(evening, 20), Local(evening + 1, 1)),
            Logged(SleepKinds.Night, Local(evening + 1, 1, 30), Local(evening + 1, 6)),
        });

        var rhythm = Measure(events);

        Assert.Equal(5, rhythm.Nights.Count);
        Assert.All(rhythm.Nights, night => Assert.Equal((600, 300, 300), ((int)night.Length.TotalMinutes, (int)night.LongestStretch.TotalMinutes, (int)night.FirstStretch.TotalMinutes)));
    }

    [Fact]
    public void Measure_ShortLongAndRunningNights_AreLeftOut()
    {
        var events = Enumerable.Range(1, 26).SelectMany(evening => Night(evening, 20, 0, 600))
            .Concat(Night(27, 20, 0, 120))
            .Append(Logged(SleepKinds.Night, Local(26, 22), Local(27, 15)))
            .Append(Marker(SleepKinds.BedTime, Local(28, 20)));

        var rhythm = Measure(events, Local(29, 2));

        Assert.Equal(Enumerable.Range(1, 25).Select(day => new DateOnly(2026, 1, day)), rhythm.Nights.Select(night => night.Evening));
    }

    [Fact]
    public void Measure_NightsOnly_NapsLackDataButCountTheBracketedDays()
    {
        var rhythm = Measure(Enumerable.Range(1, 28).SelectMany(evening => Night(evening, 20, 0, 630)));

        Assert.Equal(new CountSummary(RhythmStatus.NotEnoughData, 27, null, null, null), rhythm.Naps.PerDay);
        Assert.Empty(rhythm.Naps.UsualStarts);
    }

    [Fact]
    public void Measure_FeedsOnSomeDays_CountsOnlyDaysWithFeedsAndDropsLongGaps()
    {
        var events = Enumerable.Range(10, 5).SelectMany(day => new[] { 8, 10, 12, 14 }.Select(hour => Feed(Local(day, hour))));

        var rhythm = Measure(events);

        Assert.Equal(new CountSummary(RhythmStatus.Ok, 5, 4, 4, 4), rhythm.Feeds.PerDay);
        var twoHours = TimeSpan.FromHours(2);
        Assert.Equal(new DurationSummary(RhythmStatus.Ok, 15, twoHours, twoHours, twoHours), rhythm.Feeds.Gap);
    }

    [Fact]
    public void Measure_LongerNightsAfterMoreEveningFeeds_ReportsTheDifference()
    {
        var rhythm = Measure(EveningFeedBaby(_ => 660, _ => 600));

        var feeds = rhythm.Associations[0];
        Assert.Equal(2, feeds.Threshold);
        var night = feeds.Outcomes[0];
        Assert.Equal(
            new AssociationOutcome(RhythmOutcome.NightLength, RhythmStatus.Ok, 14, 14, TimeSpan.FromMinutes(660), TimeSpan.FromMinutes(600), TimeSpan.FromMinutes(60), TimeSpan.FromMinutes(30)),
            night);
        Assert.All(feeds.Outcomes, outcome => Assert.Equal(RhythmStatus.Ok, outcome.Status));
    }

    [Fact]
    public void Measure_DifferenceWithinTheNightsOwnSpread_IsNoClearDifference()
    {
        var rhythm = Measure(EveningFeedBaby(evening => evening % 4 == 1 ? 600 : 700, evening => evening % 4 == 0 ? 575 : 675));

        var night = rhythm.Associations[0].Outcomes[0];

        Assert.Equal(new AssociationOutcome(RhythmOutcome.NightLength, RhythmStatus.NoClearDifference, 14, 14, null, null, null, TimeSpan.FromMinutes(50)), night);
    }

    [Fact]
    public void Measure_SameNightsWithAndWithout_IsNoClearDifference()
    {
        var rhythm = Measure(EveningFeedBaby(_ => 600, _ => 600));

        Assert.All(rhythm.Associations[0].Outcomes, outcome => Assert.Equal((RhythmStatus.NoClearDifference, 14, 14, (TimeSpan?)null), (outcome.Status, outcome.NightsWith, outcome.NightsWithout, outcome.Difference)));
    }

    [Fact]
    public void Measure_DirtyDiaperGroupsTooSmall_GivesTheCountsOnly()
    {
        var diapers = Enumerable.Range(1, 14).Select(day => DiaperChange(Local(day, 12), day <= 10 ? DiaperContents.Mixed : DiaperContents.Wet));

        var rhythm = Measure(EveningFeedBaby(_ => 660, _ => 600).Concat(diapers));

        var dirty = rhythm.Associations[1];
        Assert.Equal(RhythmFactor.DirtyDiaperDay, dirty.Factor);
        Assert.All(dirty.Outcomes, outcome => Assert.Equal((RhythmStatus.NotEnoughData, 10, 4, (TimeSpan?)null, (TimeSpan?)null), (outcome.Status, outcome.NightsWith, outcome.NightsWithout, outcome.MedianWith, outcome.Difference)));
    }

    [Fact]
    public void Measure_DirtyDiaperDays_ComparesNightsAfterADirtyDiaperWithNightsAfterNone()
    {
        var diapers = Enumerable.Range(1, 28).Select(day => DiaperChange(Local(day, 12), day % 2 == 1 ? DiaperContents.Dirty : DiaperContents.Wet));

        var rhythm = Measure(EveningFeedBaby(_ => 660, _ => 600).Concat(diapers));

        var night = rhythm.Associations[1].Outcomes[0];
        Assert.Equal((RhythmStatus.Ok, 14, 14, 60), (night.Status, night.NightsWith, night.NightsWithout, (int)night.Difference!.Value.TotalMinutes));
    }

    [Fact]
    public void Measure_AnyInputOrder_GivesTheSameRhythm()
    {
        var events = RegularBaby().Concat(EveningFeedBaby(_ => 660, _ => 600)).ToList();
        var random = new Random(42);
        var shuffled = events.OrderBy(_ => random.Next()).ToList();
        var reversed = Enumerable.Reverse(events).ToList();

        var expected = Json(Measure(events));

        Assert.Equal(expected, Json(Measure(shuffled)));
        Assert.Equal(expected, Json(Measure(reversed)));
    }

    [Fact]
    public void Measure_FussySpellsFutureAndOldEvents_ChangeNothing()
    {
        var baby = RegularBaby();
        var noise = new[]
        {
            new ObservedEvent(Fussy, Local(10, 18), Local(10, 18, 30), ConfirmedNotCrying: true),
            new ObservedEvent(Fussy, Local(11, 18), Local(11, 18, 30)),
            Feed(Local(29, 16)),
            Feed(Local(30, 10)),
            Feed(new DateTimeOffset(2025, 12, 30, 12, 0, 0, Offset)),
            Marker(SleepKinds.BedTime, new DateTimeOffset(2025, 12, 30, 20, 0, 0, Offset)),
        };

        Assert.Equal(Json(Measure(baby)), Json(Measure(baby.Concat(noise))));
    }

    [Fact]
    public void Measure_AFalseAlarmFlaggedEvent_IsNeverRead()
    {
        var baby = RegularBaby();
        var falseAlarms = Enumerable.Range(1, 28).Select(day => new ObservedEvent(Feeding, Local(day, 11, 30), Local(day, 11, 30), ConfirmedNotCrying: true));

        Assert.Equal(Json(Measure(baby)), Json(Measure(baby.Concat(falseAlarms))));
    }
}
