using Lotties.Domain.Clinical;

namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// One baby a community run reads (docs/design/34-community-insights.md section 5.3): her id, her family (the babies sharing an Owner;
/// used only to count families), her stored birth date (only to compute her age in completed weeks on each day; it never reaches the
/// aggregation input) and the time of the consent line in force (her records are read only from the first full day after it).
/// </summary>
public sealed record CommunitySubject(Guid BabyId, Guid FamilyId, DateOnly BirthDate, DateTimeOffset ConsentedAt);

/// <summary>The calendar days of a community run: UTC days (no time zone is stored for a baby, and the job reads none).</summary>
public static class CommunityDays
{
    public static DateOnly DayOf(DateTimeOffset instant) => DateOnly.FromDateTime(instant.UtcDateTime);

    public static DateTimeOffset StartOf(DateOnly day) => new(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    /// <summary>The first midnight (UTC) at or after <paramref name="instant"/>.</summary>
    public static DateTimeOffset FirstMidnightFrom(DateTimeOffset instant)
    {
        var start = StartOf(DayOf(instant));
        return start == instant.ToUniversalTime() ? start : start.AddDays(1);
    }

    /// <summary>Completed weeks from <paramref name="birthDate"/> to <paramref name="day"/>; <c>null</c> for a day before the birth date.</summary>
    public static int? AgeWeeksOn(DateOnly birthDate, DateOnly day) => day < birthDate ? null : (day.DayNumber - birthDate.DayNumber) / 7;
}

/// <summary>
/// What a run reads of one baby, in time (docs/design/34-community-insights.md section 5.3): events that started from
/// <see cref="ReadFrom"/> (the first midnight after her consent in force) to <see cref="ReadBefore"/> (the midnight that started
/// the run's day), and the days it counts, <see cref="FirstDay"/> to <see cref="LastDay"/>: the first read day is only a lead-in, so
/// a sleep that ran past its midnight is whole on the first counted day, and the run's own day is not over. The percentile statistics
/// count only the days of <see cref="PercentileWindow"/>, the previous calendar quarter (<see cref="CommunityDataWindow.PreviousQuarterOf"/>).
/// </summary>
public sealed record CommunityReadSpan(DateTimeOffset ReadFrom, DateTimeOffset ReadBefore, DateOnly FirstDay, DateOnly LastDay, CommunityDataWindow PercentileWindow)
{
    public static CommunityReadSpan For(DateTimeOffset consentedAt, DateTimeOffset now)
    {
        var readFrom = CommunityDays.FirstMidnightFrom(consentedAt);
        var readBefore = CommunityDays.StartOf(CommunityDays.DayOf(now));
        return new CommunityReadSpan(
            readFrom,
            readBefore,
            CommunityDays.DayOf(readFrom).AddDays(1),
            CommunityDays.DayOf(readBefore).AddDays(-1),
            CommunityDataWindow.PreviousQuarterOf(now));
    }

    /// <summary>Whether there is anything to read (a consent from before the run's day).</summary>
    public bool HasDays => FirstDay <= LastDay;

    public bool Counts(DateOnly day) => day >= FirstDay && day <= LastDay;
}

/// <summary>The observations of one baby, ready for <see cref="CommunityAggregationInput"/>.</summary>
public sealed record CommunityBabyObservations(
    IReadOnlyList<CommunityTummyTimeDay> TummyTimeDays,
    IReadOnlyList<CommunityCrySpell> CrySpells,
    IReadOnlyList<CommunityBottleFeed> BottleFeeds,
    IReadOnlyList<CommunityRoutineDay> RoutineDays)
{
    public static CommunityBabyObservations None { get; } = new([], [], [], []);
}

/// <summary>
/// Turns one baby's <see cref="CommunityEventRows"/> into the observations of the v1 statistics (docs/design/34-community-insights.md
/// section 5.3); pure, no I/O. Days are UTC calendar days of <see cref="CommunityReadSpan"/>; ages are completed weeks on each day.
/// <list type="bullet">
/// <item>A <b>complete day</b> (design 34 section 4, routines): a counted day with at least one feed that started on it and some
/// effective sleep of finished sessions inside it (the clinical summary's days with sleep). Days before the family's first log, after
/// its last one, or simply not logged are not complete, so they never count as zeros.</item>
/// <item><b>Routine days</b> (night sleep, naps, day sleep): complete days of the percentile window that no running sleep session
/// overlaps; night and day sleep are the effective minutes of finished night and other sessions inside the day (pauses spread over the
/// session, split at midnight, as in the clinical summary), naps the finished non-night sessions that started on it. A kind of sleep
/// that was not logged is missing, never zero: night sleep only on a day with effective night time inside it; naps and day sleep only
/// on a day on which a finished non-night session started (the two on the same days). A real day without a nap is therefore left out
/// of naps and day sleep.</item>
/// <item><b>Tummy time days</b>: only for a baby with at least one finished tummy time with effective time on a counted day (a family
/// that never logs it contributes nothing); then every complete day that no running tummy time session overlaps, with the effective
/// tummy minutes inside the day (0 when none).</item>
/// <item><b>Bottles</b>: finished formula bottles with an amount that started on a counted day of the percentile window.</item>
/// <item><b>Crying</b>: answered spells that started on a counted day.</item>
/// </list>
/// A day before the birth date is never read.
/// </summary>
public static class CommunityObservationDeriver
{
    private const double MillisecondsPerMinute = 60_000;

    public static CommunityBabyObservations Derive(CommunitySubject subject, CommunityEventRows rows, CommunityReadSpan span)
    {
        ArgumentNullException.ThrowIfNull(subject);
        ArgumentNullException.ThrowIfNull(rows);
        ArgumentNullException.ThrowIfNull(span);
        if (!span.HasDays)
        {
            return CommunityBabyObservations.None;
        }

        var days = DayTotals.Of(subject, rows, span);
        return new CommunityBabyObservations(
            [.. days.Complete.Where(day => days.LogsTummyTime && day.Date < days.TummyRunningFrom).Select(day => TummyDay(subject, day))],
            [.. rows.Spells.Select(spell => SpellOf(subject, spell, span)).OfType<CommunityCrySpell>()],
            [.. rows.Feeds.Select(feed => BottleOf(subject, feed, span)).OfType<CommunityBottleFeed>()],
            [.. days.Complete.Where(day => day.Date < days.SleepRunningFrom && span.PercentileWindow.Contains(day.Date)).Select(day => RoutineDay(subject, day)).Where(HasValue)]);
    }

    private static CommunityTummyTimeDay TummyDay(CommunitySubject subject, DayTotal day) =>
        new(subject.BabyId, subject.FamilyId, day.AgeWeeks, day.Date, Minutes(day.TummyMs));

    /// <summary>The day's routine values; a kind of sleep not logged that day is null (missing), never 0.</summary>
    private static CommunityRoutineDay RoutineDay(CommunitySubject subject, DayTotal day) =>
        new(
            subject.BabyId,
            subject.FamilyId,
            day.AgeWeeks,
            day.Date,
            day.NightMs > 0 ? Minutes(day.NightMs) : null,
            day.Naps > 0 ? day.Naps : null,
            day.Naps > 0 ? Minutes(day.NapMs) : null);

    private static bool HasValue(CommunityRoutineDay day) => day.NightSleepMinutes is not null || day.NapsPerDay is not null;

    private static CommunityCrySpell? SpellOf(CommunitySubject subject, CommunitySpellRow spell, CommunityReadSpan span)
    {
        var day = CommunityDays.DayOf(spell.StartedAt);
        return span.Counts(day) && CommunityDays.AgeWeeksOn(subject.BirthDate, day) is { } age
            ? new CommunityCrySpell(subject.BabyId, subject.FamilyId, age, day, spell.Cause)
            : null;
    }

    private static CommunityBottleFeed? BottleOf(CommunitySubject subject, CommunityFeedRow feed, CommunityReadSpan span)
    {
        var day = CommunityDays.DayOf(feed.StartedAt);
        var counted = feed.FormulaDrunkMl is not null && span.Counts(day) && span.PercentileWindow.Contains(day);
        return counted && CommunityDays.AgeWeeksOn(subject.BirthDate, day) is { } age
            ? new CommunityBottleFeed(subject.BabyId, subject.FamilyId, age, day, BottleSampler.Formula, feed.FormulaDrunkMl!.Value)
            : null;
    }

    private static decimal Minutes(double milliseconds) => Math.Round((decimal)(milliseconds / MillisecondsPerMinute), 2);

    /// <summary>One counted day of one baby, with her age and what was logged inside it.</summary>
    private sealed record DayTotal(DateOnly Date, int AgeWeeks, bool HasFeed, double NightMs, double NapMs, int Naps, double TummyMs)
    {
        public bool IsComplete => HasFeed && NightMs + NapMs > 0;
    }

    /// <summary>A finished timed session (sleep or tummy time): its instants and its finished pauses.</summary>
    private readonly record struct FinishedSession(DateTimeOffset Start, DateTimeOffset End, int PausedSeconds);

    /// <summary>A part of a finished session inside one day.</summary>
    private readonly record struct DayShare(DateOnly Day, double Milliseconds);

    /// <summary>
    /// The complete days of one baby, the first day a running session makes unknown (<see cref="DateOnly.MaxValue"/> when none
    /// runs: a running session counts from its start to now, so every day from the one it started on has no known value), and whether
    /// she logs tummy time at all (some effective tummy time on a counted day).
    /// </summary>
    private sealed record DayTotals(IReadOnlyList<DayTotal> Complete, DateOnly SleepRunningFrom, DateOnly TummyRunningFrom, bool LogsTummyTime)
    {
        public static DayTotals Of(CommunitySubject subject, CommunityEventRows rows, CommunityReadSpan span)
        {
            var finishedSleep = rows.Sleeps.Where(sleep => sleep.EndedAt is not null).ToArray();
            var night = SharesByDay(span, finishedSleep.Where(sleep => sleep.IsNight).Select(sleep => new FinishedSession(sleep.StartedAt, sleep.EndedAt!.Value, sleep.PausedSeconds)));
            var nap = SharesByDay(span, finishedSleep.Where(sleep => !sleep.IsNight).Select(sleep => new FinishedSession(sleep.StartedAt, sleep.EndedAt!.Value, sleep.PausedSeconds)));
            var tummy = SharesByDay(span, rows.TummyTimes.Where(item => item.EndedAt is not null).Select(item => new FinishedSession(item.StartedAt, item.EndedAt!.Value, item.PausedSeconds)));
            var naps = finishedSleep.Where(sleep => !sleep.IsNight).CountBy(sleep => CommunityDays.DayOf(sleep.StartedAt)).ToDictionary();
            var feedDays = rows.Feeds.Select(feed => CommunityDays.DayOf(feed.StartedAt)).ToHashSet();
            var complete = Enumerable.Range(0, span.LastDay.DayNumber - span.FirstDay.DayNumber + 1)
                .Select(span.FirstDay.AddDays)
                .Where(day => CommunityDays.AgeWeeksOn(subject.BirthDate, day) is not null)
                .Select(day => new DayTotal(
                    day,
                    CommunityDays.AgeWeeksOn(subject.BirthDate, day)!.Value,
                    feedDays.Contains(day),
                    night.GetValueOrDefault(day),
                    nap.GetValueOrDefault(day),
                    naps.GetValueOrDefault(day),
                    tummy.GetValueOrDefault(day)))
                .Where(day => day.IsComplete)
                .ToArray();
            return new DayTotals(
                complete,
                RunningFrom(rows.Sleeps.Where(sleep => sleep.EndedAt is null).Select(sleep => sleep.StartedAt)),
                RunningFrom(rows.TummyTimes.Where(item => item.EndedAt is null).Select(item => item.StartedAt)),
                tummy.Values.Any(milliseconds => milliseconds > 0));
        }

        private static DateOnly RunningFrom(IEnumerable<DateTimeOffset> runningStarts) =>
            runningStarts.Select(CommunityDays.DayOf).DefaultIfEmpty(DateOnly.MaxValue).Min();

        private static IReadOnlyDictionary<DateOnly, double> SharesByDay(CommunityReadSpan span, IEnumerable<FinishedSession> sessions) =>
            sessions.SelectMany(session => Spread(span, session))
                .GroupBy(share => share.Day)
                .ToDictionary(group => group.Key, group => group.Sum(share => share.Milliseconds));

        /// <summary>
        /// The effective time of a session inside each counted day it touches (the clinical summary's split at midnight); days outside
        /// the span are not computed, so a session with a far end costs no more than the span.
        /// </summary>
        private static IEnumerable<DayShare> Spread(CommunityReadSpan span, FinishedSession session)
        {
            var startMs = session.Start.ToUnixTimeMilliseconds();
            var endMs = session.End.ToUnixTimeMilliseconds();
            var first = Max(CommunityDays.DayOf(session.Start), span.FirstDay);
            var last = Min(CommunityDays.DayOf(session.End), span.LastDay);
            var count = Math.Max(0, last.DayNumber - first.DayNumber + 1);
            return Enumerable.Range(0, count)
                .Select(first.AddDays)
                .Select(day => new DayShare(day, PauseMath.EffectiveMsInWindow(startMs, endMs, session.PausedSeconds, null, MsOf(day), MsOf(day.AddDays(1)), endMs)));
        }

        private static DateOnly Max(DateOnly left, DateOnly right) => left > right ? left : right;

        private static DateOnly Min(DateOnly left, DateOnly right) => left < right ? left : right;

        private static long MsOf(DateOnly day) => CommunityDays.StartOf(day).ToUnixTimeMilliseconds();
    }
}
