using System.Reflection;
using Lotties.Domain.CommunityInsights;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Tests.CommunityInsights;

/// <summary>
/// The pure part of event loading (docs/design/34-community-insights.md section 5.3): which facts of a stored event are kept
/// (<see cref="CommunityEventRows"/>), the span of days a run reads after a consent (<see cref="CommunityReadSpan"/>), and how one baby's
/// rows become observations (<see cref="CommunityObservationDeriver"/>): complete days, the clinical summary's sleep split, running timers,
/// formula bottles drunk, answered spells and the age in completed weeks. Days are UTC days.
/// </summary>
public sealed class CommunityObservationDeriverTests
{
    /// <summary>Consent at noon on 1 June 2026: 2 June is the lead-in day, 3 June the first counted day.</summary>
    private static readonly DateTimeOffset ConsentedAt = new(2026, 6, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>A run in the fourth quarter of 2026: the percentile window is July to September 2026.</summary>
    private static readonly DateTimeOffset RunAt = new(2026, 11, 29, 3, 30, 0, TimeSpan.Zero);

    private static readonly DateOnly Birth = new(2026, 5, 4);

    private static readonly CommunitySubject Subject = new(Guid.NewGuid(), Guid.NewGuid(), Birth, ConsentedAt);

    private static readonly CommunityReadSpan Span = CommunityReadSpan.For(ConsentedAt, RunAt);

    private static readonly DateOnly InWindow = new(2026, 8, 10);

    // ── Read span ────────────────────────────────────────────────────────────

    [Fact]
    public void Span_ReadsFromTheFirstMidnightAfterTheConsent_CountsFromTheNextDay_AndStopsBeforeTheRunsDay()
    {
        Assert.Equal(new DateTimeOffset(2026, 6, 2, 0, 0, 0, TimeSpan.Zero), Span.ReadFrom);
        Assert.Equal(new DateOnly(2026, 6, 3), Span.FirstDay);
        Assert.Equal(new DateTimeOffset(2026, 11, 29, 0, 0, 0, TimeSpan.Zero), Span.ReadBefore);
        Assert.Equal(new DateOnly(2026, 11, 28), Span.LastDay);
        Assert.Equal(new CommunityDataWindow(new DateOnly(2026, 7, 1), new DateOnly(2026, 9, 30)), Span.PercentileWindow);
    }

    [Fact]
    public void Span_ConsentAtMidnight_ReadsFromThatMidnight()
    {
        var span = CommunityReadSpan.For(new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), RunAt);

        Assert.Equal(new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), span.ReadFrom);
        Assert.Equal(new DateOnly(2026, 6, 2), span.FirstDay);
    }

    [Fact]
    public void Span_ConsentYesterday_HasNoDayToRead()
    {
        var span = CommunityReadSpan.For(RunAt.AddDays(-1), RunAt);

        Assert.False(span.HasDays);
        Assert.Equal(CommunityBabyObservations.None, CommunityObservationDeriver.Derive(Subject, Rows(feeds: [Feed(RunAt.AddHours(-30))]), span));
    }

    [Theory]
    [InlineData("2026-05-04", 0)]
    [InlineData("2026-05-10", 0)]
    [InlineData("2026-05-11", 1)]
    [InlineData("2026-08-10", 14)]
    public void AgeWeeks_IsCompletedWeeksSinceTheStoredBirthDate(string day, int expected) =>
        Assert.Equal(expected, CommunityDays.AgeWeeksOn(Birth, DateOnly.Parse(day, System.Globalization.CultureInfo.InvariantCulture)));

    [Fact]
    public void AgeWeeks_BeforeTheBirthDate_IsUnknown() => Assert.Null(CommunityDays.AgeWeeksOn(Birth, Birth.AddDays(-1)));

    // ── Rows: what is kept of a stored event ────────────────────────────────

    [Fact]
    public void Rows_KeepOnlyTheFourReadTypes()
    {
        var at = At(InWindow, 9);
        var rows = CommunityEventRows.Read(
        [
            Stored(BuiltInEventTypes.MedicationId, at, at, """{"medications":[{"name":"x"}]}"""),
            Stored(BuiltInEventTypes.TemperatureId, at, at, """{"value_c":38.5}"""),
            Stored(BuiltInEventTypes.DiaperId, at, at, """{"content":"WET"}"""),
            Stored(Guid.NewGuid(), at, at.AddMinutes(20), "{}"), // a baby's own type, even one named like tummy_time
        ]);

        Assert.Equal(CommunityEventRows.Empty, rows, RowsComparer.Instance);
    }

    [Fact]
    public void Rows_Feeding_KeepsTheDrunkAmountOfFinishedFormulaBottlesOnly()
    {
        var at = At(InWindow, 9);
        var rows = CommunityEventRows.Read(
        [
            Stored(BuiltInEventTypes.FeedingId, at, at, """{"method":"bottle","bottle_feeding_type":"formula","amount_ml":120,"amount_drunk_ml":90,"formula_name":"Brand X","formula_id":"f"}"""),
            Stored(BuiltInEventTypes.FeedingId, at, at, """{"method":"bottle","bottle_feeding_type":"formula","amount_ml":150}"""),
            Stored(BuiltInEventTypes.FeedingId, at, at, """{"method":"bottle","bottle_feeding_type":"breast_milk","amount_ml":100}"""),
            Stored(BuiltInEventTypes.FeedingId, at, at, """{"method":"bottle","amount_ml":100}"""),
            Stored(BuiltInEventTypes.FeedingId, at, null, """{"method":"bottle","bottle_feeding_type":"formula","amount_ml":100}"""),
            Stored(BuiltInEventTypes.FeedingId, at, at.AddMinutes(15), """{"method":"breast","side":"left"}"""),
            Stored(BuiltInEventTypes.FeedingId, at, at, """{"method":"solid","food":"banana"}"""),
            Stored(BuiltInEventTypes.FeedingId, at, at, """{"method":"bottle","bottle_feeding_type":"formula"}"""),
        ]);

        Assert.Equal(new decimal?[] { 90m, 150m, null, null, null, null, null, null }, rows.Feeds.Select(feed => feed.FormulaDrunkMl));
    }

    [Fact]
    public void Rows_Sleep_KeepsSessionsOnly_NightOrNot_AndTheirPauses()
    {
        var at = At(InWindow, 13);
        var rows = CommunityEventRows.Read(
        [
            Stored(BuiltInEventTypes.SleepId, at, at.AddHours(1), """{"kind":"nap","paused_seconds":600,"how_slept":"in_bed"}"""),
            Stored(BuiltInEventTypes.SleepId, at, at.AddHours(1), "{}"),
            Stored(BuiltInEventTypes.SleepId, at, at.AddHours(9), """{"kind":"night"}"""),
            Stored(BuiltInEventTypes.SleepId, at, at.AddMinutes(10), """{"kind":"night_waking"}"""),
            Stored(BuiltInEventTypes.SleepId, at, at, """{"kind":"bed_time"}"""),
            Stored(BuiltInEventTypes.SleepId, at, at, """{"kind":"woke_up"}"""),
            Stored(BuiltInEventTypes.SleepId, at, at, """{"kind":"fell_asleep"}"""),
        ]);

        Assert.Equal(
            [new CommunitySleepRow(at, at.AddHours(1), false, 600), new CommunitySleepRow(at, at.AddHours(1), false, 0), new CommunitySleepRow(at, at.AddHours(9), true, 0)],
            rows.Sleeps);
    }

    [Fact]
    public void Rows_Fussy_KeepsAnsweredSpellsThatAreNotFalseAlarms_AsTheCauseThatHelped()
    {
        var at = At(InWindow, 18);
        var rows = CommunityEventRows.Read(
        [
            Stored(BuiltInEventTypes.FussyId, at, at.AddMinutes(20), """{"what_helped":"feeding","intensity":"intense","suggested_cause":"gas"}"""),
            Stored(BuiltInEventTypes.FussyId, at, at.AddMinutes(20), """{"what_helped":"massage"}"""),
            Stored(BuiltInEventTypes.FussyId, at, at.AddMinutes(20), """{"what_helped":"nothing"}"""),
            Stored(BuiltInEventTypes.FussyId, at, at.AddMinutes(20), """{"what_helped":"a_future_option"}"""),
            Stored(BuiltInEventTypes.FussyId, at, at.AddMinutes(20), """{"what_helped":"rocking","auto_detected":true,"cry_confirmed":true}"""),
            Stored(BuiltInEventTypes.FussyId, at, at.AddMinutes(20), """{"what_helped":"rocking","auto_detected":true,"cry_confirmed":false}"""),
            Stored(BuiltInEventTypes.FussyId, at, at.AddMinutes(20), """{"intensity":"mild"}"""),
            Stored(BuiltInEventTypes.FussyId, at, at.AddMinutes(20), """{"what_helped":7}"""),
        ]);

        Assert.Equal(["hunger", "gas", "none", "none", "comfort"], rows.Spells.Select(spell => spell.Cause));
    }

    /// <summary>Data minimisation by construction: the row and observation records have only these members (no text, no id of a record).</summary>
    [Fact]
    public void RowAndObservationRecords_HaveOnlyTheMembersTheStatisticsNeed()
    {
        Assert.Equal(["FormulaDrunkMl", "StartedAt"], Members<CommunityFeedRow>());
        Assert.Equal(["EndedAt", "IsNight", "PausedSeconds", "StartedAt"], Members<CommunitySleepRow>());
        Assert.Equal(["EndedAt", "PausedSeconds", "StartedAt"], Members<CommunityTummyRow>());
        Assert.Equal(["Cause", "StartedAt"], Members<CommunitySpellRow>());
        Assert.Equal(["AgeWeeks", "BabyId", "FamilyId", "LocalDay", "TummyMinutes"], Members<CommunityTummyTimeDay>());
        Assert.Equal(["AgeWeeks", "BabyId", "FamilyId", "HelpedCause", "LocalDay"], Members<CommunityCrySpell>());
        Assert.Equal(["AgeWeeks", "BabyId", "DrunkMl", "FamilyId", "FeedingType", "LocalDay"], Members<CommunityBottleFeed>());
        Assert.Equal(["AgeWeeks", "BabyId", "DaySleepMinutes", "FamilyId", "LocalDay", "NapsPerDay", "NightSleepMinutes"], Members<CommunityRoutineDay>());
    }

    // ── Complete days, tummy time ───────────────────────────────────────────

    [Fact]
    public void TummyDays_OnlyCompleteDays_WithZeroWhenNoTummyTime()
    {
        var logged = InWindow;
        var notLogged = InWindow.AddDays(1);
        var sleepOnly = InWindow.AddDays(2);
        var withTummy = InWindow.AddDays(3);
        var rows = Rows(
            feeds: [Feed(At(logged, 8)), Feed(At(withTummy, 8)), Feed(At(notLogged.AddDays(10), 8))],
            sleeps: [Nap(At(logged, 13), 60), Nap(At(sleepOnly, 13), 60), Nap(At(withTummy, 13), 60)],
            tummy: [Tummy(At(withTummy, 10), 15)]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        Assert.Equal([(logged, 0m), (withTummy, 15m)], observations.TummyTimeDays.Select(day => (day.LocalDay, day.TummyMinutes)));
        Assert.All(observations.TummyTimeDays, day => Assert.Equal(Subject.BabyId, day.BabyId));
        Assert.All(observations.TummyTimeDays, day => Assert.Equal(Subject.FamilyId, day.FamilyId));
        Assert.Equal(CommunityDays.AgeWeeksOn(Birth, logged), observations.TummyTimeDays[0].AgeWeeks);
    }

    [Fact]
    public void TummyDays_PausesRemoved_SplitAtMidnight()
    {
        var day = InWindow;
        var rows = Rows(
            feeds: [Feed(At(day, 8)), Feed(At(day.AddDays(1), 8))],
            sleeps: [Nap(At(day, 13), 60), Nap(At(day.AddDays(1), 13), 60)],
            tummy: [new CommunityTummyRow(At(day, 23).AddMinutes(30), At(day, 23).AddMinutes(70), 600)]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        // 40 minutes of wall time, 10 paused: 30 effective, spread 30/40 before midnight and 10/40 after.
        Assert.Equal([22.5m, 7.5m], observations.TummyTimeDays.Select(item => item.TummyMinutes));
    }

    [Fact]
    public void TummyDays_ARunningTummyTimer_LeavesOutEveryDayFromItsStart()
    {
        var days = Enumerable.Range(0, 4).Select(InWindow.AddDays).ToArray();
        var rows = Rows(
            feeds: [.. days.Select(day => Feed(At(day, 8)))],
            sleeps: [.. days.Select(day => Nap(At(day, 13), 60))],
            tummy: [new CommunityTummyRow(At(days[2], 10), null, 0)]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        Assert.Equal(days[..2], observations.TummyTimeDays.Select(day => day.LocalDay));
        Assert.Equal(4, observations.RoutineDays.Count);
    }

    [Fact]
    public void Days_BeforeTheFirstCountedDay_OrOnTheRunsDay_AreNotCounted()
    {
        var rows = Rows(
            feeds: [Feed(At(Span.FirstDay.AddDays(-1), 8)), Feed(At(Span.FirstDay, 8)), Feed(At(Span.LastDay.AddDays(1), 1))],
            sleeps: [Nap(At(Span.FirstDay.AddDays(-1), 13), 60), Nap(At(Span.FirstDay, 13), 60), Nap(At(Span.LastDay.AddDays(1), 1), 30)]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        Assert.Equal([Span.FirstDay], observations.TummyTimeDays.Select(day => day.LocalDay));
    }

    [Fact]
    public void Days_BeforeTheBirthDate_AreNotRead()
    {
        var subject = Subject with { BirthDate = InWindow.AddDays(1) };
        var rows = Rows(
            feeds: [Feed(At(InWindow, 8)), Feed(At(InWindow.AddDays(1), 8))],
            sleeps: [Nap(At(InWindow, 13), 60), Nap(At(InWindow.AddDays(1), 13), 60)],
            spells: [new CommunitySpellRow(At(InWindow, 18), "hunger")]);

        var observations = CommunityObservationDeriver.Derive(subject, rows, Span);

        Assert.Equal([InWindow.AddDays(1)], observations.TummyTimeDays.Select(day => day.LocalDay));
        Assert.Equal([0], observations.TummyTimeDays.Select(day => day.AgeWeeks));
        Assert.Empty(observations.CrySpells);
    }

    // ── Routine days ────────────────────────────────────────────────────────

    [Fact]
    public void RoutineDays_NightSplitAtMidnight_NapsCountedOnTheirStartDay_PausesRemoved()
    {
        var day = InWindow;
        var rows = Rows(
            feeds: [Feed(At(day, 8)), Feed(At(day.AddDays(1), 8))],
            sleeps:
            [
                new CommunitySleepRow(At(day, 20), At(day.AddDays(1), 6), true, 0),
                new CommunitySleepRow(At(day, 10), At(day, 11), false, 600),
                Nap(At(day, 14), 90),
                Nap(At(day.AddDays(1), 13), 60),
            ]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        var first = observations.RoutineDays.Single(item => item.LocalDay == day);
        var second = observations.RoutineDays.Single(item => item.LocalDay == day.AddDays(1));
        Assert.Equal((240m, 2m, 140m), (first.NightSleepMinutes!.Value, first.NapsPerDay!.Value, first.DaySleepMinutes!.Value));
        Assert.Equal((360m, 1m, 60m), (second.NightSleepMinutes!.Value, second.NapsPerDay!.Value, second.DaySleepMinutes!.Value));
    }

    [Fact]
    public void RoutineDays_AreThePercentileWindowsDaysOnly()
    {
        var before = new DateOnly(2026, 6, 30);
        var after = new DateOnly(2026, 10, 1);
        var rows = Rows(
            feeds: [Feed(At(before, 8)), Feed(At(InWindow, 8)), Feed(At(after, 8))],
            sleeps: [Nap(At(before, 13), 60), Nap(At(InWindow, 13), 60), Nap(At(after, 13), 60)]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        Assert.Equal([InWindow], observations.RoutineDays.Select(day => day.LocalDay));
        Assert.Equal([before, InWindow, after], observations.TummyTimeDays.Select(day => day.LocalDay));
    }

    [Fact]
    public void RoutineDays_ARunningSleep_LeavesOutEveryDayFromItsStart_ButNotTheTummyDays()
    {
        var days = Enumerable.Range(0, 3).Select(InWindow.AddDays).ToArray();
        var rows = Rows(
            feeds: [.. days.Select(day => Feed(At(day, 8)))],
            sleeps: [.. days.Select(day => Nap(At(day, 13), 60)), new CommunitySleepRow(At(days[1], 20), null, true, 0)]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        Assert.Equal([days[0]], observations.RoutineDays.Select(day => day.LocalDay));
        Assert.Equal(days, observations.TummyTimeDays.Select(day => day.LocalDay));
    }

    [Fact]
    public void RoutineDays_ADayWithoutAFeed_OrWithoutSleep_IsNotComplete()
    {
        var rows = Rows(
            feeds: [Feed(At(InWindow.AddDays(1), 8))],
            sleeps: [Nap(At(InWindow, 13), 60)]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        Assert.Empty(observations.RoutineDays);
        Assert.Empty(observations.TummyTimeDays);
    }

    // ── Bottles and crying ──────────────────────────────────────────────────

    [Fact]
    public void Bottles_FormulaWithAnAmount_InThePercentileWindow()
    {
        var rows = Rows(feeds:
        [
            new CommunityFeedRow(At(InWindow, 8), 90m),
            new CommunityFeedRow(At(InWindow, 11), null),
            new CommunityFeedRow(At(new DateOnly(2026, 6, 30), 8), 100m),
            new CommunityFeedRow(At(new DateOnly(2026, 10, 2), 8), 110m),
        ]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        var bottle = Assert.Single(observations.BottleFeeds);
        Assert.Equal((InWindow, 90m, "formula", 14), (bottle.LocalDay, bottle.DrunkMl, bottle.FeedingType, bottle.AgeWeeks));
    }

    [Fact]
    public void CrySpells_OnCountedDays_WholeHistorySinceTheConsent()
    {
        var rows = Rows(spells:
        [
            new CommunitySpellRow(At(Span.FirstDay.AddDays(-1), 18), "hunger"),
            new CommunitySpellRow(At(Span.FirstDay, 18), "gas"),
            new CommunitySpellRow(At(InWindow, 18), "comfort"),
            new CommunitySpellRow(At(Span.LastDay.AddDays(1), 1), "sleepy"),
        ]);

        var observations = CommunityObservationDeriver.Derive(Subject, rows, Span);

        Assert.Equal(["gas", "comfort"], observations.CrySpells.Select(spell => spell.HelpedCause));
    }

    private static IReadOnlyList<string> Members<T>() =>
        [.. typeof(T).GetProperties(BindingFlags.Instance | BindingFlags.Public).Where(property => property.Name != "EqualityContract").Select(property => property.Name).Order(StringComparer.Ordinal)];

    private static DateTimeOffset At(DateOnly day, int hour) => new(day.ToDateTime(new TimeOnly(hour, 0)), TimeSpan.Zero);

    private static CommunityStoredEvent Stored(Guid typeId, DateTimeOffset start, DateTimeOffset? end, string payload) =>
        new(typeId, start, end, EventPayload.From(payload));

    private static CommunityFeedRow Feed(DateTimeOffset at) => new(at, null);

    private static CommunitySleepRow Nap(DateTimeOffset start, int minutes) => new(start, start.AddMinutes(minutes), false, 0);

    private static CommunityTummyRow Tummy(DateTimeOffset start, int minutes) => new(start, start.AddMinutes(minutes), 0);

    private static CommunityEventRows Rows(
        IReadOnlyList<CommunityFeedRow>? feeds = null,
        IReadOnlyList<CommunitySleepRow>? sleeps = null,
        IReadOnlyList<CommunityTummyRow>? tummy = null,
        IReadOnlyList<CommunitySpellRow>? spells = null) =>
        new(feeds ?? [], sleeps ?? [], tummy ?? [], spells ?? []);

    /// <summary>Compares rows by their lists' contents (records compare lists by reference).</summary>
    private sealed class RowsComparer : IEqualityComparer<CommunityEventRows>
    {
        public static RowsComparer Instance { get; } = new();

        public bool Equals(CommunityEventRows? x, CommunityEventRows? y) =>
            x is not null && y is not null
            && x.Feeds.SequenceEqual(y.Feeds) && x.Sleeps.SequenceEqual(y.Sleeps) && x.TummyTimes.SequenceEqual(y.TummyTimes) && x.Spells.SequenceEqual(y.Spells);

        public int GetHashCode(CommunityEventRows obj) => 0;
    }
}
