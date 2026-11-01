using Lotties.Domain.Exceptions;
using Lotties.Domain.Rest;

namespace Lotties.Domain.Tests.Rest;

/// <summary>Rules R1 to R6 and the edge cases of docs/design/41-caregiver-rest.md, with the worked example of section 2.</summary>
public sealed class RestEstimatorTests
{
    private const string Sp = "America/Sao_Paulo"; // UTC-3, no daylight saving now
    private static readonly Guid Mother = Guid.NewGuid();
    private static readonly Guid Father = Guid.NewGuid();
    private static readonly Guid Baby = Guid.NewGuid();
    private static readonly Guid Twin = Guid.NewGuid();
    private static readonly DateOnly Night = new(2026, 10, 29);
    private static readonly DateTimeOffset Now = new(2026, 10, 31, 12, 0, 0, TimeSpan.Zero);

    private static DateTimeOffset At(string zone, string local)
    {
        var dt = DateTime.SpecifyKind(DateTime.Parse(local, System.Globalization.CultureInfo.InvariantCulture), DateTimeKind.Unspecified);
        var tz = TimeZoneInfo.FindSystemTimeZoneById(zone);
        return new DateTimeOffset(dt - tz.GetUtcOffset(dt), TimeSpan.Zero);
    }

    private static DateTimeOffset T(string local) => At(Sp, local);

    private static RestSettings Settings(string zone = Sp, IReadOnlyList<RestWorkWindow>? work = null, bool enabled = true, int fall = 20, int lead = 20) =>
        new(enabled, zone, work ?? [], new TimeOnly(19, 0), new TimeOnly(7, 0), fall, lead);

    private static RestEvent Sleep(string start, string? end, Guid? baby = null, string zone = Sp, Guid? by = null) =>
        new(baby ?? Baby, true, At(zone, start), end is null ? null : At(zone, end), by ?? Mother, At(zone, start), false);

    private static RestEvent Care(string at, Guid by, string zone = Sp, string? createdAt = null, bool imported = false, Guid? baby = null) =>
        new(baby ?? Baby, false, At(zone, at), null, by, At(zone, createdAt ?? at), imported);

    private static RestNight Run(Guid person, RestSettings settings, IEnumerable<RestEvent> events, DateTimeOffset? answer = null, DateOnly? night = null, DateTimeOffset? now = null) =>
        RestEstimator.Estimate(new RestInput(settings, person, night ?? Night, now ?? Now, answer, events));

    private static void Part(RestPart p, string start, string? end, RestStartSource ss, RestEndSource es, RestConfidence c = RestConfidence.Normal, string zone = Sp)
    {
        Assert.Equal(At(zone, start), p.Start);
        Assert.Equal(end is null ? null : At(zone, end), p.End);
        Assert.Equal(ss, p.StartSource);
        Assert.Equal(es, p.EndSource);
        Assert.Equal(c, p.Confidence);
    }

    [Fact]
    public void R1_BabyBedtimePlusN_PersonWhoLoggedNothingRested_EndsAtFinalWake()
    {
        var r = Run(Father, Settings(fall: 10), [Sleep("2026-10-29 21:00", "2026-10-30 06:30")]);

        Assert.Equal(RestStatus.Ok, r.Status);
        var p = Assert.Single(r.Parts);
        Part(p, "2026-10-29 21:10", "2026-10-30 06:30", RestStartSource.BabyLog, RestEndSource.BabyFinalWake, RestConfidence.Low);
        Assert.True(r.AskMorning);
        Assert.Equal(10, r.Constants.FallAsleepMinutes);
    }

    [Fact]
    public void R1_SleepOutsideNightWindow_IsNotABedtime()
    {
        var r = Run(Mother, Settings(), [Sleep("2026-10-29 14:00", "2026-10-29 15:30")]);

        Assert.Equal(RestStatus.NotEnoughLog, r.Status);
        Assert.Empty(r.Parts);
        Assert.False(r.AskMorning);
    }

    [Fact]
    public void R2_OwnEventAfterBedtime_EndsRestLeadBefore()
    {
        var r = Run(Mother, Settings(), [Sleep("2026-10-29 21:00", "2026-10-30 06:30"), Care("2026-10-30 02:10", Mother)]);

        var p = Assert.Single(r.Parts);
        Part(p, "2026-10-29 21:20", "2026-10-30 01:50", RestStartSource.BabyLog, RestEndSource.OwnEvent);
        Assert.False(r.AskMorning);
    }

    [Fact]
    public void R3_BabySleepsAgain_PersonFallsAsleepNMinutesLater()
    {
        var events = new[]
        {
            Sleep("2026-10-29 21:00", "2026-10-30 02:00"),
            Care("2026-10-30 02:10", Mother),
            Sleep("2026-10-30 02:40", "2026-10-30 06:00"),
        };
        var r = Run(Mother, Settings(), events);

        Assert.Equal(2, r.Parts.Count);
        Part(r.Parts[1], "2026-10-30 03:00", "2026-10-30 06:00", RestStartSource.BabyLog, RestEndSource.BabyFinalWake, RestConfidence.Low);
    }

    [Fact]
    public void R3_PersonWhoLoggedNothingRestsThroughTheBabysWakeups()
    {
        var events = new[]
        {
            Sleep("2026-10-29 21:00", "2026-10-30 02:00"),
            Sleep("2026-10-30 02:40", "2026-10-30 06:00"),
            Care("2026-10-30 02:10", Mother),
        };
        var r = Run(Father, Settings(), events);

        var p = Assert.Single(r.Parts);
        Part(p, "2026-10-29 21:20", "2026-10-30 06:00", RestStartSource.BabyLog, RestEndSource.BabyFinalWake, RestConfidence.Low);
    }

    [Fact]
    public void R4_BothGetUp_BothAwakeUntilTheBabySleeps_ThenBothFallAsleepNLater()
    {
        var events = new[]
        {
            Sleep("2026-10-29 21:00", "2026-10-30 02:00"),
            Care("2026-10-30 02:10", Mother),
            Care("2026-10-30 02:15", Father),
            Sleep("2026-10-30 02:40", "2026-10-30 06:00"),
        };
        var mother = Run(Mother, Settings(), events);
        var father = Run(Father, Settings(), events);

        foreach (var r in new[] { mother, father })
        {
            Assert.Equal(2, r.Parts.Count);
            Assert.Equal(T("2026-10-30 03:00"), r.Parts[1].Start);
        }

        Assert.Equal(T("2026-10-30 01:50"), mother.Parts[0].End);
        Assert.Equal(T("2026-10-30 01:55"), father.Parts[0].End);
    }

    [Fact]
    public void R5_Morning_OwnEventMinusLead_EndsTheFinalPart()
    {
        var events = new[] { Sleep("2026-10-29 21:00", "2026-10-30 05:30"), Care("2026-10-30 06:00", Mother) };
        var r = Run(Mother, Settings(), events);

        var p = Assert.Single(r.Parts);
        Part(p, "2026-10-29 21:20", "2026-10-30 05:40", RestStartSource.BabyLog, RestEndSource.OwnEvent);
    }

    [Fact]
    public void R5_ConfirmedAnswer_EndsRestNormalConfidence_NoQuestion()
    {
        var events = new[] { Sleep("2026-10-29 21:00", "2026-10-30 06:00") };
        var r = Run(Father, Settings(), events, answer: T("2026-10-30 06:40"));

        var p = Assert.Single(r.Parts);
        Part(p, "2026-10-29 21:20", "2026-10-30 06:40", RestStartSource.BabyLog, RestEndSource.Confirmed);
        Assert.False(r.AskMorning);
    }

    [Fact]
    public void R5_NoOwnEventNoAnswer_EndsAtBabyFinalWakeLowAndAsks()
    {
        var r = Run(Father, Settings(), [Sleep("2026-10-29 21:00", "2026-10-30 06:00")]);

        var p = Assert.Single(r.Parts);
        Assert.Equal(RestEndSource.BabyFinalWake, p.EndSource);
        Assert.Equal(RestConfidence.Low, p.Confidence);
        Assert.True(r.AskMorning);
    }

    [Fact]
    public void R5_WorkWindowStartingBeforeFinalWake_EndsRestFirst()
    {
        var work = new[] { new RestWorkWindow([5], new TimeOnly(5, 30), new TimeOnly(14, 0)) }; // Friday 2026-10-30
        var r = Run(Father, Settings(work: work), [Sleep("2026-10-29 21:00", "2026-10-30 06:30")]);

        var p = Assert.Single(r.Parts);
        Part(p, "2026-10-29 21:20", "2026-10-30 05:30", RestStartSource.BabyLog, RestEndSource.WorkWindow);
        Assert.False(r.AskMorning);
    }

    [Fact]
    public void WorkedExample_MotherAndFather()
    {
        var events = new[]
        {
            Sleep("2026-10-29 21:00", "2026-10-30 02:00"),
            Sleep("2026-10-30 02:40", "2026-10-30 04:30"),
            Sleep("2026-10-30 05:00", "2026-10-30 07:00"),
            Care("2026-10-30 02:10", Mother),
            Care("2026-10-30 04:35", Mother),
        };

        var mother = Run(Mother, Settings(), events);
        Assert.Equal(3, mother.Parts.Count);
        Part(mother.Parts[0], "2026-10-29 21:20", "2026-10-30 01:50", RestStartSource.BabyLog, RestEndSource.OwnEvent);
        Part(mother.Parts[1], "2026-10-30 03:00", "2026-10-30 04:15", RestStartSource.BabyLog, RestEndSource.OwnEvent);
        Part(mother.Parts[2], "2026-10-30 05:20", "2026-10-30 07:00", RestStartSource.BabyLog, RestEndSource.BabyFinalWake, RestConfidence.Low);
        Assert.False(mother.AskMorning);

        var father = Run(Father, Settings(), events);
        var p = Assert.Single(father.Parts);
        Part(p, "2026-10-29 21:20", "2026-10-30 07:00", RestStartSource.BabyLog, RestEndSource.BabyFinalWake, RestConfidence.Low);
        Assert.True(father.AskMorning);
    }

    [Fact]
    public void R6_OvernightWorkWindow_NotRestingInside_ResumesAtItsEnd()
    {
        // Thursday 2026-10-29 22:00 to Friday 06:00.
        var work = new[] { new RestWorkWindow([4], new TimeOnly(22, 0), new TimeOnly(6, 0)) };
        var r = Run(Mother, Settings(work: work), [Sleep("2026-10-29 21:00", "2026-10-30 06:45")]);

        Assert.Equal(2, r.Parts.Count);
        Part(r.Parts[0], "2026-10-29 21:20", "2026-10-29 22:00", RestStartSource.BabyLog, RestEndSource.WorkWindow);
        Part(r.Parts[1], "2026-10-30 06:00", "2026-10-30 06:45", RestStartSource.WorkWindowEnd, RestEndSource.BabyFinalWake, RestConfidence.Low);
    }

    [Fact]
    public void R6_BedtimeInsideWorkWindow_RestStartsAtWindowEnd_AndOwnEventsInsideAreIgnored()
    {
        var work = new[] { new RestWorkWindow([4], new TimeOnly(20, 0), new TimeOnly(23, 0)) };
        var events = new[] { Sleep("2026-10-29 21:00", "2026-10-30 06:00"), Care("2026-10-29 22:00", Mother) };
        var r = Run(Mother, Settings(work: work), events);

        var p = Assert.Single(r.Parts);
        Part(p, "2026-10-29 23:00", "2026-10-30 06:00", RestStartSource.WorkWindowEnd, RestEndSource.BabyFinalWake, RestConfidence.Low);
    }

    [Fact]
    public void R6_WorkWindowOnOtherDays_DoesNotApply()
    {
        var work = new[] { new RestWorkWindow([1, 2, 3], new TimeOnly(20, 0), new TimeOnly(23, 0)) };
        var r = Run(Father, Settings(work: work), [Sleep("2026-10-29 21:00", "2026-10-30 06:00")]);

        Assert.Equal(T("2026-10-29 21:20"), Assert.Single(r.Parts).Start);
    }

    [Fact]
    public void Dst_SpringForwardNight_IsComputedOnInstants()
    {
        // America/New_York, 2026-03-07 night into Sunday 2026-03-08: 02:00 jumps to 03:00 (EST -5 to EDT -4).
        const string Ny = "America/New_York";
        var night = new DateOnly(2026, 3, 7);
        var events = new[] { Sleep("2026-03-07 21:00", "2026-03-08 06:30", zone: Ny) };
        var r = Run(Father, Settings(Ny), events, night: night, now: new DateTimeOffset(2026, 3, 9, 12, 0, 0, TimeSpan.Zero));

        var p = Assert.Single(r.Parts);
        Assert.Equal(new DateTimeOffset(2026, 3, 8, 2, 20, 0, TimeSpan.Zero), p.Start); // 21:20 EST
        Assert.Equal(new DateTimeOffset(2026, 3, 8, 10, 30, 0, TimeSpan.Zero), p.End); // 06:30 EDT, 8h10 later in real time
    }

    [Fact]
    public void Dst_FallBackNight_NightWindowIsOneHourLonger_OwnEventInTheRepeatedHour()
    {
        // Europe/Lisbon, night of 2026-10-24 into Sunday 25: 02:00 WEST goes back to 01:00 WET.
        const string Lis = "Europe/Lisbon";
        var night = new DateOnly(2026, 10, 24);
        var bed = At(Lis, "2026-10-24 22:00");
        var ev = new RestEvent(Baby, false, new DateTimeOffset(2026, 10, 25, 1, 30, 0, TimeSpan.Zero), null, Mother, new DateTimeOffset(2026, 10, 25, 1, 30, 0, TimeSpan.Zero), false);
        var sleep = new RestEvent(Baby, true, bed, At(Lis, "2026-10-25 06:30"), Mother, bed, false);
        var r = Run(Mother, Settings(Lis), [sleep, ev], night: night, now: new DateTimeOffset(2026, 10, 26, 12, 0, 0, TimeSpan.Zero));

        var p = Assert.Single(r.Parts);
        Assert.Equal(bed + TimeSpan.FromMinutes(20), p.Start);
        Assert.Equal(new DateTimeOffset(2026, 10, 25, 1, 10, 0, TimeSpan.Zero), p.End);
        Assert.Equal(RestEndSource.OwnEvent, p.EndSource);
    }

    [Fact]
    public void BackfilledEvent_MoreThan15MinutesLate_IsNotProofOfBeingAwake()
    {
        var events = new[] { Sleep("2026-10-29 21:00", "2026-10-30 06:00"), Care("2026-10-30 02:10", Mother, createdAt: "2026-10-30 02:26") };
        var r = Run(Mother, Settings(), events);

        var p = Assert.Single(r.Parts);
        Assert.Equal(RestEndSource.BabyFinalWake, p.EndSource);
    }

    [Fact]
    public void BackfilledEvent_Within15Minutes_Counts()
    {
        var events = new[] { Sleep("2026-10-29 21:00", "2026-10-30 06:00"), Care("2026-10-30 02:10", Mother, createdAt: "2026-10-30 02:25") };
        var r = Run(Mother, Settings(), events);

        Assert.Equal(T("2026-10-30 01:50"), Assert.Single(r.Parts).End);
    }

    [Fact]
    public void ImportedEvent_IsNotAnOwnEvent_ButImportedBabySleepStillCounts()
    {
        var importedSleep = Sleep("2026-10-29 21:00", "2026-10-30 06:00") with { Imported = true };
        var events = new[] { importedSleep, Care("2026-10-30 02:10", Mother, imported: true) };
        var r = Run(Mother, Settings(), events);

        var p = Assert.Single(r.Parts);
        Assert.Equal(T("2026-10-29 21:20"), p.Start);
        Assert.Equal(RestEndSource.BabyFinalWake, p.EndSource);
    }

    [Fact]
    public void BabySleepLoggedByThePerson_IsNotAnOwnEvent()
    {
        var events = new[] { Sleep("2026-10-29 21:00", "2026-10-30 06:00", by: Mother), Sleep("2026-10-30 02:40", "2026-10-30 03:00", by: Mother) };
        var r = Run(Mother, Settings(), events);

        Assert.Single(r.Parts);
    }

    [Fact]
    public void EventByAnotherPerson_DoesNotWakeThisOne()
    {
        var events = new[] { Sleep("2026-10-29 21:00", "2026-10-30 06:00"), Care("2026-10-30 02:10", Mother) };
        var r = Run(Father, Settings(), events);

        Assert.Equal(RestEndSource.BabyFinalWake, Assert.Single(r.Parts).EndSource);
    }

    [Fact]
    public void TwoBabies_PersonRestsOnlyWhenEveryBabyIsAsleep()
    {
        var events = new[]
        {
            Sleep("2026-10-29 21:00", "2026-10-30 06:00", Baby),
            Sleep("2026-10-29 21:30", "2026-10-30 05:30", Twin),
        };
        var r = Run(Father, Settings(), events);

        var p = Assert.Single(r.Parts);
        Assert.Equal(T("2026-10-29 21:50"), p.Start); // twin asleep 21:30 + 20
        Assert.Equal(T("2026-10-30 05:30"), p.End); // the last all-asleep interval ends when the first baby wakes
    }

    [Fact]
    public void TwoBabies_SecondBabyAwakeMidNight_StartsANewRestPartAfterBothSleep()
    {
        var events = new[]
        {
            Sleep("2026-10-29 21:00", "2026-10-30 06:00", Baby),
            Sleep("2026-10-29 21:00", "2026-10-30 01:00", Twin),
            Sleep("2026-10-30 02:00", "2026-10-30 06:00", Twin),
            Care("2026-10-30 01:20", Mother, baby: Twin),
        };
        var r = Run(Mother, Settings(), events);

        Assert.Equal(2, r.Parts.Count);
        Assert.Equal(T("2026-10-30 01:00"), r.Parts[0].End); // lead 20 before 01:20
        Assert.Equal(T("2026-10-30 02:20"), r.Parts[1].Start);
    }

    [Fact]
    public void Viewer_WithNoOwnEvents_GetsR1AndR5Only()
    {
        var events = new[] { Sleep("2026-10-29 21:00", "2026-10-30 02:00"), Sleep("2026-10-30 02:30", "2026-10-30 06:00"), Care("2026-10-30 02:10", Mother) };
        var r = Run(Guid.NewGuid(), Settings(), events);

        var p = Assert.Single(r.Parts);
        Assert.Equal(RestStartSource.BabyLog, p.StartSource);
        Assert.Equal(RestEndSource.BabyFinalWake, p.EndSource);
        Assert.True(r.AskMorning);
    }

    [Fact]
    public void Disabled_ReadsNothing()
    {
        IEnumerable<RestEvent> Throwing()
        {
            throw new InvalidOperationException("events must not be read");
#pragma warning disable CS0162
            yield break;
#pragma warning restore CS0162
        }

        var r = Run(Mother, Settings(enabled: false), Throwing());

        Assert.Equal(RestStatus.Disabled, r.Status);
        Assert.Empty(r.Parts);
        Assert.False(r.AskMorning);
    }

    [Fact]
    public void RunningBabySleep_IsOngoing()
    {
        var r = Run(Father, Settings(), [Sleep("2026-10-29 21:00", null)], now: T("2026-10-30 01:00"));

        var p = Assert.Single(r.Parts);
        Part(p, "2026-10-29 21:20", null, RestStartSource.BabyLog, RestEndSource.Ongoing);
        Assert.False(r.AskMorning);
    }

    [Fact]
    public void NoBabySleepInWindow_NotEnoughLog_NoParts()
    {
        var r = Run(Mother, Settings(), [Care("2026-10-30 02:10", Mother)]);

        Assert.Equal(RestStatus.NotEnoughLog, r.Status);
        Assert.Empty(r.Parts);
    }

    [Fact]
    public void OwnEventSoonAfterBedtime_PersonNeverFellAsleepThatStretch()
    {
        var events = new[] { Sleep("2026-10-29 21:00", "2026-10-30 06:00"), Care("2026-10-29 21:30", Mother) };
        var r = Run(Mother, Settings(), events);

        Assert.Empty(r.Parts);
    }

    [Fact]
    public void Settings_Validate_ReusableRules()
    {
        RestSettings.Defaults.Validate();
        Assert.Equal("timeZone", Assert.Throws<DomainValidationException>(() => Settings("Nowhere/Land").Validate()).Field);
        Assert.Equal("fallAsleepMinutes", Assert.Throws<DomainValidationException>(() => Settings(fall: 4).Validate()).Field);
        Assert.Equal("wakeLeadMinutes", Assert.Throws<DomainValidationException>(() => Settings(lead: 61).Validate()).Field);
        Assert.Equal("nightEnd", Assert.Throws<DomainValidationException>(() => (Settings() with { NightEnd = new TimeOnly(19, 0) }).Validate()).Field);
        var same = new[] { new RestWorkWindow([1], new TimeOnly(8, 0), new TimeOnly(8, 0)) };
        Assert.Equal("workWindows[0].end", Assert.Throws<DomainValidationException>(() => Settings(work: same).Validate()).Field);
        var dup = new[] { new RestWorkWindow([1, 1], new TimeOnly(8, 0), new TimeOnly(9, 0)) };
        Assert.Equal("workWindows[0].days", Assert.Throws<DomainValidationException>(() => Settings(work: dup).Validate()).Field);
        var many = Enumerable.Repeat(new RestWorkWindow([1], new TimeOnly(8, 0), new TimeOnly(9, 0)), 15).ToList();
        Assert.Equal("workWindows", Assert.Throws<DomainValidationException>(() => Settings(work: many).Validate()).Field);
        Assert.True(RestSettings.TryParseClock("08:05", out var t) && t == new TimeOnly(8, 5));
        Assert.False(RestSettings.TryParseClock("8:05", out _));
    }
}
