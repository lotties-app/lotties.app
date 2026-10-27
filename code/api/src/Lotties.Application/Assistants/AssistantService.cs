using Lotties.Application.Clinical;
using Lotties.Application.Events;
using Lotties.Application.Users;
using Lotties.Domain.Appointments;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Clinical;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
using Lotties.Domain.Units;
using Lotties.Application.Units;
using Lotties.Domain.Prescriptions;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Assistants;

/// <remarks>
/// Every write is the same idempotent upsert as <c>PUT /events/{id}</c> (<see cref="IEventService"/>: field rules, formula
/// references, the Caregiver rules), with the event id derived from the adapter's request (<see cref="AssistantEventIds"/>):
/// when that event exists the request is a retry and its stored outcome is answered without writing again. Ending a sleep
/// edits the running timer (its own id; a Caregiver may stop someone else's, the running-event exception) and logs the
/// <c>woke_up</c> marker under the derived id, which is what makes the retry detectable. A sleep that starts does not stop a
/// running feeding here (the web's "ended by sleep" rule is client-side; docs/design/32-assistants.md section 5). Logs
/// carry the command and result code only, never words or slot values.
/// </remarks>
internal sealed class AssistantService(
    AssistantSubjects subjects,
    IEventService eventService,
    IEventRepository events,
    IClinicalEventRepository clinicalEvents,
    IFormulaRepository formulas,
    IAppointmentRepository appointments,
    VaccineOverviewReader vaccines,
    DailyObservationReader dailyObservations,
AssistantForecasts forecasts,
    AssistantCryReasons cryReasons,
    IUnitPreferences unitPreferences,
    IPrescriptionRepository prescriptions,
    IMedicationRepository medications,
    IMedicationDoseHistoryRepository medicationDoses,
    ILogger<AssistantService> logger) : IAssistantService
{
    /// <summary>How far back a day or week summary may be asked for, in days before the user's today.</summary>
    public const int SummaryHistoryDays = 365;

    private const int WeekDays = 7;

    /// <summary>An amount above this is out of range whatever its unit (keeps the ml conversion far from overflow).</summary>
    private const decimal MaxSpokenAmount = 100_000m;

    private const string SleepKey = "sleep";
    private const string FeedingKey = "feeding";
    private const string DiaperKey = "diaper";
    private const int RecentTake = 100;

    private static readonly TimeSpan FutureSkew = Event.MaxClientClockSkew;
    private static readonly TimeSpan SleepLookback = TimeSpan.FromDays(30);
    private static readonly TimeSpan FeedingLookback = TimeSpan.FromDays(30);
    private static readonly TimeSpan NursingLookback = TimeSpan.FromDays(7);
    private static readonly TimeSpan AppointmentHorizon = TimeSpan.FromDays(366);
    private static readonly TimeSpan UndoWindow = TimeSpan.FromMinutes(30);
    private const int VaccinesTold = 5;
    private const string WokeUpEntry = "woke_up";
    private const int AverageDays = 7;
    private static readonly string[] MadeByAssistantKeys = [SleepKey, FeedingKey, DiaperKey];
    private static readonly TimeSpan DeleteWindow = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan DeleteLookback = TimeSpan.FromHours(1);
    private const int MinimumAverageDays = 3;
    private const int MinimumBottles = 3;
    private const int BottlesAveraged = 5;
    private const int BottleTake = 200;
    private static readonly TimeSpan BottleLookback = TimeSpan.FromDays(14);
    private static readonly TimeSpan DiaperLookback = TimeSpan.FromDays(30);

    public Task<AssistantResult> LogSleepStartAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.SleepStart, AssistantAccess.Log, subject => StartSleepAsync(invocation, subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogSleepEndAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.SleepEnd, AssistantAccess.Log, subject => EndSleepAsync(invocation, subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogBottleAsync(AssistantInvocation invocation, int? amountMl, BottleKind kind, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Bottle, AssistantAccess.Log, subject => LogBottleAsync(invocation, subject, amountMl, kind, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogBottleVolumeAsync(AssistantInvocation invocation, decimal? amount, VolumeUnit? unit, BottleKind kind, CancellationToken cancellationToken = default) =>
        RunAsync(
            invocation,
            AssistantCommands.Bottle,
            AssistantAccess.Log,
            async subject => await LogBottleAsync(invocation, subject, await MillilitersOfAsync(invocation, amount, unit, cancellationToken), kind, cancellationToken),
            cancellationToken);

    public Task<AssistantResult> LogNursingAsync(AssistantInvocation invocation, BreastSide? side, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Nursing, AssistantAccess.Log, subject => StartNursingAsync(invocation, subject, side, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogDiaperAsync(AssistantInvocation invocation, DiaperKind kind, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Diaper, AssistantAccess.Log, subject => LogDiaperAsync(invocation, subject, kind, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadLastFeedAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.LastFeed, AssistantAccess.Read, subject => LastFeedAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadSleepStatusAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.SleepStatus, AssistantAccess.Read, subject => SleepStatusAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadDiapersTodayAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.DiapersToday, AssistantAccess.Read, subject => DiapersTodayAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadNextAppointmentAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.NextAppointment, AssistantAccess.Read, subject => NextAppointmentAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadDueVaccinesAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.DueVaccines, AssistantAccess.Read, subject => DueVaccinesAsync(subject, cancellationToken), cancellationToken);

    public async Task<AssistantResult> ListBabiesAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(invocation);
        var family = await subjects.LoadFamilyAsync(invocation, cancellationToken);
        var result = family.Refusal ?? new AssistantResult
        {
            Code = AssistantResultCode.Babies,
            AsOf = family.Now,
            Babies = family.Members.Select(member => AccessOf(member, family.SayBabyName)).ToArray(),
        };
        Log(invocation, AssistantCommands.ListBabies, result);
        return result;
    }

    public Task<AssistantResult> ReadBabyProfileAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.BabyProfile, AssistantAccess.Read, subject => Task.FromResult(Profile(subject)), cancellationToken);

    public Task<AssistantResult> ReadDaySummaryAsync(AssistantInvocation invocation, DateOnly? date, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.DaySummary, AssistantAccess.Read, subject => SummaryAsync(subject, date, 1, AssistantResultCode.DaySummary, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadWeekSummaryAsync(AssistantInvocation invocation, DateOnly? endDate, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.WeekSummary, AssistantAccess.Read, subject => SummaryAsync(subject, endDate, WeekDays, AssistantResultCode.WeekSummary, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadNextNapWindowAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.NextNapWindow, AssistantAccess.Read, subject => forecasts.NextNapWindowAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadNextFeedAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.NextFeed, AssistantAccess.Read, subject => forecasts.NextFeedAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadNextDiaperAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.NextDiaper, AssistantAccess.Read, subject => forecasts.NextDiaperAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadDiapersAverageAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.DiapersAverage, AssistantAccess.Read, subject => DiapersAverageAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadBottleAverageAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.BottleAverage, AssistantAccess.Read, subject => BottleAverageAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadSleepTodayAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.SleepToday, AssistantAccess.Read, subject => SleepTodayAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadBottleTodayAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.BottleToday, AssistantAccess.Read, subject => FeedTotalsAsync(subject, AssistantResultCode.BottleToday, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadFeedsTodayAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.FeedsToday, AssistantAccess.Read, subject => FeedTotalsAsync(subject, AssistantResultCode.FeedsToday, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadLastDiaperAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.LastDiaper, AssistantAccess.Read, subject => LastDiaperAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> RequestDeleteLastAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.RequestDeleteLast, AssistantAccess.Log, subject => RequestDeleteLastAsync(subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadCryReasonsAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.CryReasons, AssistantAccess.Read, subject => cryReasons.ReadAsync(subject, cancellationToken), cancellationToken);

    private async Task<AssistantResult> RunAsync(
        AssistantInvocation invocation,
        string command,
        AssistantAccess access,
        Func<AssistantSubject, Task<AssistantResult>> work,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(invocation);
        var lookup = await subjects.LoadAsync(invocation, access, cancellationToken);
        var result = lookup.Subject is { } subject
            ? await work(subject) with { Units = await unitPreferences.ResolveAsync(invocation.Locale, cancellationToken) }
            : lookup.Refusal!;
        Log(invocation, command, result);
        return result;
    }

    /// <summary>
    /// The whole ml of a spoken or typed amount: in ounces by <see cref="UnitConversions"/>, in ml rounded to whole ml; an amount
    /// without a unit is read in the user's system. <c>null</c> (so: invalid amount) when there is none or it is not positive.
    /// </summary>
    private async Task<int?> MillilitersOfAsync(AssistantInvocation invocation, decimal? amount, VolumeUnit? unit, CancellationToken cancellationToken)
    {
        if (amount is not > 0)
        {
            return null;
        }

        var capped = Math.Min(amount.Value, MaxSpokenAmount);
        var chosen = unit ?? (await unitPreferences.ResolveAsync(invocation.Locale, cancellationToken) == UnitSystem.Us ? VolumeUnit.FluidOunces : VolumeUnit.Milliliters);
        return chosen == VolumeUnit.FluidOunces
            ? UnitConversions.FluidOuncesToMl(capped)
            : (int)Math.Round(capped, MidpointRounding.AwayFromZero);
    }

    private void Log(AssistantInvocation invocation, string command, AssistantResult result) =>
        logger.LogInformation(
            "Assistant {Adapter} {Command} for baby {BabyId}: {ResultCode}",
            invocation.Adapter,
            command,
            result.Baby?.Id,
            AssistantResult.CodeName(result.Code));

    /// <summary>
    /// The <paramref name="dayCount"/> local days ending with <paramref name="lastDay"/> (else today) through the clinical
    /// summary's reader and math, unchanged: the same days, buckets and rounding the doctor's summary and the Insights use.
    /// </summary>
    private async Task<AssistantResult> SummaryAsync(AssistantSubject subject, DateOnly? lastDay, int dayCount, AssistantResultCode code, CancellationToken cancellationToken)
    {
        var clock = ClockOf(subject);
        var today = clock.DateOf(subject.Now);
        var earliest = today.AddDays(-SummaryHistoryDays);
        var zoned = subject.Result(code) with { TimeZone = subject.ZoneId ?? AssistantZoneChoice.UtcId, TimeZoneSource = subject.ZoneSource };
        if (lastDay is { } asked && (asked > today || asked < earliest))
        {
            return zoned with { Code = AssistantResultCode.InvalidDate, EarliestDate = earliest, LatestDate = today };
        }

        var window = ClinicalWindow.Create(ClinicalRange.LastDays(lastDay ?? today, dayCount), clock, subject.Now);
        var daily = await dailyObservations.LoadAsync(subject.Baby.Id, window, cancellationToken);
        var sleep = SleepSummaries.Summarize(daily.Sleep, window);
        var feeding = FeedingSummaries.Summarize(daily.Feeds, window);
        var diapers = DiaperSummaries.Summarize(daily.Diapers, window);
        var days = window.Days
            .Select((day, index) => new AssistantDaySummary(day.Date, day.Date < today, sleep.Days[index], feeding.Days[index], diapers.Days[index]))
            .ToArray();
        return zoned with { Days = days };
    }

    private static AssistantResult Profile(AssistantSubject subject)
    {
        var today = ClockOf(subject).DateOf(subject.Now);
        var days = Math.Max(0, today.DayNumber - subject.Baby.BirthDate.DayNumber);
        var months = Math.Max(0, AgeBands.CompletedMonths(subject.Baby.BirthDate, today));
        return subject.Result(AssistantResultCode.BabyProfile) with { Age = new AssistantBabyAge(days, days / WeekDays, months) };
    }

    private static AssistantBabyAccess AccessOf(AssistantFamilyMember member, bool sayBabyName) =>
        new(member.Baby.Id, sayBabyName ? member.Baby.Name : null, member.Role.ToString().ToLowerInvariant(), member.Role.CanLogEvents(), member.IsDefault);

    /// <summary>The user's local clock, or UTC days when no zone is known (summaries then report <c>UTC</c>).</summary>
    private static LocalClock ClockOf(AssistantSubject subject) =>
        subject.Zone is { } zone ? LocalClock.InZone(zone) : LocalClock.WithOffset(TimeSpan.Zero);

    private async Task<AssistantResult> StartSleepAsync(AssistantInvocation invocation, AssistantSubject subject, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.SleepStart, subject);
        if (await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken) is { } replayed)
        {
            return subject.Result(AssistantResultCode.SleepStarted) with { At = replayed.StartedAt };
        }

        var recent = await RecentAsync(subject, SleepKey, SleepLookback, cancellationToken);
        if (recent.FirstOrDefault(AssistantEventFacts.IsRunningSleepTimer) is { } running)
        {
            return subject.Result(AssistantResultCode.SleepAlreadyRunning) with { At = running.StartedAt };
        }

        var kind = AssistantEventFacts.SleepKindAt(recent, subject.Now, subject.Zone);
        var created = await CreateAsync(subject, eventId, BuiltInEventTypes.SleepId, subject.Now, endedAt: null, AssistantPayloads.SleepTimer(kind), cancellationToken);
        return subject.Result(AssistantResultCode.SleepStarted) with { At = created.StartedAt };
    }

    private async Task<AssistantResult> EndSleepAsync(AssistantInvocation invocation, AssistantSubject subject, CancellationToken cancellationToken)
    {
        var markerId = IdOf(invocation, AssistantCommands.SleepEnd, subject);
        var recent = await RecentAsync(subject, SleepKey, SleepLookback, cancellationToken);
        if (await events.FindForBabyAsync(subject.Baby.Id, markerId, cancellationToken) is { } marker)
        {
            return EndedAt(subject, marker.StartedAt, recent.FirstOrDefault(sleep => AssistantEventFacts.IsSleepTimer(sleep) && sleep.EndedAt == marker.StartedAt));
        }

        var running = recent.Where(AssistantEventFacts.IsRunningSleepTimer).ToArray();
        if (running.Length != 1)
        {
            return running.Length == 0
                ? subject.Result(AssistantResultCode.NoRunningSleep)
                : subject.Result(AssistantResultCode.SeveralRunningSleeps) with { Count = running.Length };
        }

        var stopped = await StopAsync(subject, running[0], cancellationToken);
        await StopAllAsync(subject, recent.Where(AssistantEventFacts.IsRunningNightWaking), stopped.EndedAt!.Value, cancellationToken);
        await CreateAsync(subject, markerId, BuiltInEventTypes.SleepId, stopped.EndedAt.Value, stopped.EndedAt.Value, AssistantPayloads.SleepTimer(SleepKinds.WokeUp), cancellationToken);
        return EndedAt(subject, stopped.EndedAt.Value, stopped);
    }

    private async Task<AssistantResult> LogBottleAsync(AssistantInvocation invocation, AssistantSubject subject, int? amountMl, BottleKind kind, CancellationToken cancellationToken)
    {
        if (!AssistantLimits.IsBottleAmount(amountMl))
        {
            return subject.Result(AssistantResultCode.InvalidAmount) with { Min = AssistantLimits.BottleMinMl, Max = AssistantLimits.BottleMaxMl };
        }

        var eventId = IdOf(invocation, AssistantCommands.Bottle, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.FeedingId, subject.Now, subject.Now, await BottlePayloadAsync(subject, amountMl!.Value, kind, cancellationToken), cancellationToken);
        var feed = AssistantEventFacts.ReadFeed(stored);
        return subject.Result(AssistantResultCode.BottleLogged) with
        {
            At = stored.StartedAt,
            AmountMl = feed.AmountMl,
            BottleKind = feed.BottleKind,
        };
    }

    private async Task<AssistantResult> StartNursingAsync(AssistantInvocation invocation, AssistantSubject subject, BreastSide? side, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Nursing, subject);
        if (await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken) is { } replayed)
        {
            return subject.Result(AssistantResultCode.NursingStarted) with { At = replayed.StartedAt, Side = AssistantEventFacts.ReadFeed(replayed).Side };
        }

        var recent = await RecentAsync(subject, FeedingKey, NursingLookback, cancellationToken);
        if (recent.FirstOrDefault(AssistantEventFacts.IsRunningNursing) is { } running)
        {
            return subject.Result(AssistantResultCode.NursingAlreadyRunning) with { At = running.StartedAt };
        }

        var chosen = side ?? AssistantEventFacts.SuggestedNursingSide(recent);
        var created = await CreateAsync(subject, eventId, BuiltInEventTypes.FeedingId, subject.Now, endedAt: null, AssistantPayloads.Nursing(chosen, subject.Now), cancellationToken);
        return subject.Result(AssistantResultCode.NursingStarted) with { At = created.StartedAt, Side = chosen };
    }

    private async Task<AssistantResult> LogDiaperAsync(AssistantInvocation invocation, AssistantSubject subject, DiaperKind kind, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Diaper, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.DiaperId, subject.Now, subject.Now, AssistantPayloads.Diaper(kind), cancellationToken);
        return subject.Result(AssistantResultCode.DiaperLogged) with { At = stored.StartedAt, Diaper = AssistantEventFacts.DiaperKindOf(stored) ?? kind };
    }

    private async Task<AssistantResult> LastFeedAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var latest = (await RecentAsync(subject, FeedingKey, FeedingLookback, cancellationToken)).FirstOrDefault();
        if (latest is null)
        {
            return subject.Result(AssistantResultCode.NoFeeds);
        }

        var feed = AssistantEventFacts.ReadFeed(latest);
        return subject.Result(AssistantResultCode.LastFeed) with
        {
            At = latest.StartedAt,
            EndedAt = latest.EndedAt,
            Running = latest.IsRunning,
            Minutes = WholeMinutes(EffectiveDuration.Of(latest.StartedAt, latest.EndedAt, latest.Payload)),
            FeedMethod = feed.Method,
            AmountMl = feed.Method == FeedMethod.Bottle ? feed.AmountMl : null,
            BottleKind = feed.Method == FeedMethod.Bottle ? feed.BottleKind : null,
            Side = feed.Method == FeedMethod.Breast ? feed.Side : null,
        };
    }

    private async Task<AssistantResult> SleepStatusAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var timers = (await RecentAsync(subject, SleepKey, SleepLookback, cancellationToken)).Where(AssistantEventFacts.IsSleepTimer).ToArray();
        if (timers.FirstOrDefault(sleep => sleep.IsRunning) is { } running)
        {
            var asOfNow = AssistantPayloads.Stopped(running.Payload, running.StartedAt, Later(running.StartedAt, subject.Now));
            return subject.Result(AssistantResultCode.Sleeping) with
            {
                At = running.StartedAt,
                Minutes = WholeMinutes(EffectiveDuration.Of(running.StartedAt, Later(running.StartedAt, subject.Now), asOfNow)),
            };
        }

        var last = timers.Where(sleep => sleep.EndedAt is not null).MaxBy(sleep => sleep.EndedAt);
        return last is null
            ? subject.Result(AssistantResultCode.NoSleeps)
            : subject.Result(AssistantResultCode.Awake) with { At = last.EndedAt, Minutes = WholeMinutes(EffectiveDuration.Of(last.StartedAt, last.EndedAt, last.Payload)) };
    }

    private async Task<AssistantResult> DiapersTodayAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var window = subject.Zone is null ? AssistantDayWindow.LastDay : AssistantDayWindow.Today;
        var from = subject.Zone is { } zone ? LocalMidnight(zone, subject.Now) : subject.Now.AddDays(-1);
        var diapers = (await clinicalEvents.ListByTypesAsync(subject.Baby.Id, [DiaperKey], from, subject.Now + FutureSkew, cancellationToken))
            .Select(typed => AssistantEventFacts.DiaperKindOf(typed.Event))
            .ToArray();
        return subject.Result(AssistantResultCode.DiapersToday) with
        {
            Window = window,
            Count = diapers.Length,
            Wet = diapers.Count(kind => kind is DiaperKind.Wet or DiaperKind.Both),
            Dirty = diapers.Count(kind => kind is DiaperKind.Dirty or DiaperKind.Both),
        };
    }

    /// <summary>
    /// The feeds since local midnight (the last 24 hours without a zone, as the diapers of today do), counted by
    /// <see cref="AssistantFeedTotals"/>: the bottle ml is the shared drunk-amount rule, never a second one.
    /// </summary>
    private async Task<AssistantResult> FeedTotalsAsync(AssistantSubject subject, AssistantResultCode code, CancellationToken cancellationToken)
    {
        var window = subject.Zone is null ? AssistantDayWindow.LastDay : AssistantDayWindow.Today;
        var from = subject.Zone is { } zone ? LocalMidnight(zone, subject.Now) : subject.Now.AddDays(-1);
        var feeds = (await clinicalEvents.ListByTypesAsync(subject.Baby.Id, [FeedingKey], from, subject.Now + FutureSkew, cancellationToken))
            .Select(typed => ClinicalObservations.Feed(typed.Event))
            .Where(feed => feed.StartedAt >= from && feed.StartedAt <= subject.Now);
        var totals = AssistantFeedTotals.Of(feeds);
        var result = subject.Result(code) with { Window = window };
        return code == AssistantResultCode.BottleToday
            ? result with { Count = totals.Bottles, AmountMl = totals.BottleMl, FormulaBottles = totals.Formula, BreastMilkBottles = totals.BreastMilk }
            : result with { Count = totals.Feeds, BottleFeeds = totals.Bottles, BreastFeeds = totals.Breast, SolidFeeds = totals.Solid };
    }

    /// <summary>The complete local days (today left out) of the last seven that have diapers, averaged to one decimal; at least three of them.</summary>
    private async Task<AssistantResult> DiapersAverageAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var clock = ClockOf(subject);
        var yesterday = clock.DateOf(subject.Now).AddDays(-1);
        var window = ClinicalWindow.Create(ClinicalRange.LastDays(yesterday, AverageDays), clock, subject.Now);
        var daily = await dailyObservations.LoadAsync(subject.Baby.Id, window, cancellationToken);
        var days = DiaperSummaries.Summarize(daily.Diapers, window).Days.Where(day => day.Total > 0).ToArray();
        var zoned = subject.Result(AssistantResultCode.NoDiapersAverage) with { TimeZone = subject.ZoneId ?? AssistantZoneChoice.UtcId, TimeZoneSource = subject.ZoneSource, Count = days.Length };
        return days.Length < MinimumAverageDays
            ? zoned
            : zoned with
            {
                Code = AssistantResultCode.DiapersAverage,
                PerDay = OneDecimal(days.Average(day => day.Total)),
                WetPerDay = OneDecimal(days.Average(day => day.Wet)),
                DirtyPerDay = OneDecimal(days.Average(day => day.Dirty)),
            };
    }

    /// <summary>Facts from her own bottles: the average and the last of her last five with an amount, from at least three in the last 14 days.</summary>
    private async Task<AssistantResult> BottleAverageAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var newest = await clinicalEvents.ListNewestByTypesAsync(subject.Baby.Id, [FeedingKey], subject.Now - BottleLookback, subject.Now + FutureSkew, BottleTake, cancellationToken);
        var bottles = newest
            .Select(typed => (Event: typed.Event, Feed: AssistantEventFacts.ReadFeed(typed.Event)))
            .Where(entry => entry.Feed.Method == FeedMethod.Bottle && entry.Feed.AmountMl is > 0 && entry.Event.StartedAt <= subject.Now)
            .OrderByDescending(entry => entry.Event.StartedAt)
            .ToArray();
        if (bottles.Length < MinimumBottles)
        {
            return subject.Result(AssistantResultCode.NoBottleData) with { Count = bottles.Length };
        }

        var used = bottles.Take(BottlesAveraged).ToArray();
        return subject.Result(AssistantResultCode.BottleAverage) with
        {
            Count = used.Length,
            AmountMl = (int)Math.Round(used.Average(entry => entry.Feed.AmountMl!.Value), MidpointRounding.AwayFromZero),
            LastAmountMl = used[0].Feed.AmountMl,
            At = used[0].Event.StartedAt,
        };
    }

    private async Task<AssistantResult> SleepTodayAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var clock = ClockOf(subject);
        var window = ClinicalWindow.Create(ClinicalRange.LastDays(clock.DateOf(subject.Now), 1), clock, subject.Now);
        var daily = await dailyObservations.LoadAsync(subject.Baby.Id, window, cancellationToken);
        SleepDayResponse today = SleepSummaries.Summarize(daily.Sleep, window).Days[0];
        return subject.Result(AssistantResultCode.SleepToday) with { Minutes = today.TotalMinutes, Count = today.Naps };
    }

    /// <summary>
    /// Marks the newest entry this adapter created in the last 30 minutes (of any kind) as a deletion request, unless it is the wake-up marker, which stops the request with <see cref="AssistantResultCode.LastNotUndoable"/> (no older entry is chosen instead): the same upsert as an edit
    /// (client time never older than the stored one), every other member kept, only <c>delete_requested_*</c> added. It
    /// never deletes, and it never touches an entry another origin made.
    /// </summary>
    private async Task<AssistantResult> RequestDeleteLastAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var candidates = await clinicalEvents.ListByTypesAsync(subject.Baby.Id, MadeByAssistantKeys, subject.Now - DeleteLookback, subject.Now + FutureSkew, cancellationToken);
        var target = candidates
            .Select(typed => (typed.TypeKey, typed.Event))
            .Where(entry => !entry.Event.IsDeleted
                && entry.Event.CreatedAt >= subject.Now - DeleteWindow
                && AssistantOrigin.ViaOf(entry.Event.Payload) == subject.Adapter)
            .OrderByDescending(entry => entry.Event.CreatedAt)
            .Cast<(EventTypeKey TypeKey, Event Event)?>()
            .FirstOrDefault();
        if (target is not { } found)
        {
            return subject.Result(AssistantResultCode.NoEntryToDelete);
        }

        if (EventPayloadFacts.Read(found.Event.Payload).Kind == SleepKinds.WokeUp)
        {
            // The very newest thing she logged is the wake-up marker: never fall back to an older entry.
            return subject.Result(AssistantResultCode.LastNotUndoable) with { At = found.Event.StartedAt, EntryType = WokeUpEntry };
        }

        await MarkDeleteRequestedAsync(subject, found.Event, cancellationToken);
        return subject.Result(AssistantResultCode.DeleteRequested) with { At = found.Event.StartedAt, EntryType = found.TypeKey.Value };
    }

    private async Task MarkDeleteRequestedAsync(AssistantSubject subject, Event entry, CancellationToken cancellationToken)
    {
        var marked = AssistantOrigin.DeleteRequested(entry.Payload, subject.Adapter, subject.Now);
        if (marked.Value == entry.Payload.Value)
        {
            return;
        }

        var request = new UpsertEventRequest
        {
            TypeId = entry.TypeId,
            StartedAt = entry.StartedAt,
            EndedAt = entry.EndedAt,
            Payload = marked,
            Notes = entry.Notes,
            UpdatedAt = Later(entry.ClientUpdatedAt, subject.Now),
        };
        await eventService.UpsertAsync(subject.Baby.Id, entry.Id, request, cancellationToken);
    }

    private async Task<AssistantResult> LastDiaperAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var latest = (await RecentAsync(subject, DiaperKey, DiaperLookback, cancellationToken)).FirstOrDefault();
        return latest is null
            ? subject.Result(AssistantResultCode.NoDiapers)
            : subject.Result(AssistantResultCode.LastDiaper) with { At = latest.StartedAt, Diaper = AssistantEventFacts.DiaperKindOf(latest) };
    }

    private async Task<AssistantResult> NextAppointmentAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var next = (await appointments.ListUpcomingAsync(subject.Baby.Id, subject.Now, subject.Now + AppointmentHorizon, cancellationToken)).FirstOrDefault();
        return next is null
            ? subject.Result(AssistantResultCode.NoAppointment)
            : subject.Result(AssistantResultCode.NextAppointment) with
            {
                At = next.StartsAt,
                Appointment = new AssistantAppointment(next.StartsAt, next.Type.ToString().ToLowerInvariant()),
            };
    }

    private async Task<AssistantResult> DueVaccinesAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var today = subject.Zone is { } zone ? LocalClock.InZone(zone).DateOf(subject.Now) : DateOnly.FromDateTime(subject.Now.UtcDateTime);
        var overview = await vaccines.ReadAsync(subject.Baby, today, cancellationToken);
        return overview.DueOrOverdue == 0
            ? subject.Result(AssistantResultCode.NoVaccinesDue)
            : subject.Result(AssistantResultCode.VaccinesDue) with
            {
                Count = overview.DueOrOverdue,
                Overdue = overview.Overdue,
                Vaccines = overview.DueDoses.Take(VaccinesTold).Select(DoseOf).ToArray(),
            };
    }

    private async Task<EventPayload> BottlePayloadAsync(AssistantSubject subject, int amountMl, BottleKind kind, CancellationToken cancellationToken)
    {
        var current = kind == BottleKind.Formula ? (await formulas.ListCurrentAsync(subject.Baby.Id, cancellationToken)).FirstOrDefault() : null;
        return AssistantPayloads.Bottle(amountMl, kind, current);
    }

    private async Task<Event> CreateAsync(AssistantSubject subject, Guid eventId, Guid typeId, DateTimeOffset startedAt, DateTimeOffset? endedAt, EventPayload payload, CancellationToken cancellationToken)
    {
        var request = new UpsertEventRequest { TypeId = typeId, StartedAt = startedAt, EndedAt = endedAt, Payload = AssistantOrigin.Created(payload, subject.Adapter), UpdatedAt = subject.Now };
        await eventService.UpsertAsync(subject.Baby.Id, eventId, request, cancellationToken);
        return await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? throw new InvalidOperationException($"Event {eventId} was saved but could not be loaded.");
    }

    /// <summary>
    /// Stops <paramref name="running"/> now (never before its start), keeping its type, start, notes and payload but for the
    /// folded pause: the stop the running-event exception allows. The client time is never older than the stored one, so the
    /// stop is never ignored as stale.
    /// </summary>
    private async Task<Event> StopAsync(AssistantSubject subject, Event running, CancellationToken cancellationToken) =>
        await StopAtAsync(subject, running, Later(running.StartedAt, subject.Now), cancellationToken);

    private async Task StopAllAsync(AssistantSubject subject, IEnumerable<Event> running, DateTimeOffset endedAt, CancellationToken cancellationToken)
    {
        foreach (var timer in running.ToArray())
        {
            await StopAtAsync(subject, timer, Later(timer.StartedAt, endedAt), cancellationToken);
        }
    }

    private async Task<Event> StopAtAsync(AssistantSubject subject, Event running, DateTimeOffset endedAt, CancellationToken cancellationToken)
    {
        var request = new UpsertEventRequest
        {
            TypeId = running.TypeId,
            StartedAt = running.StartedAt,
            EndedAt = endedAt,
            Payload = AssistantOrigin.Changed(AssistantPayloads.Stopped(running.Payload, running.StartedAt, endedAt), subject.Adapter),
            Notes = running.Notes,
            UpdatedAt = Later(running.ClientUpdatedAt, subject.Now),
        };
        await eventService.UpsertAsync(subject.Baby.Id, running.Id, request, cancellationToken);
        return await events.FindForBabyAsync(subject.Baby.Id, running.Id, cancellationToken)
            ?? throw new InvalidOperationException($"Event {running.Id} was stopped but could not be loaded.");
    }

    private async Task<IReadOnlyList<Event>> RecentAsync(AssistantSubject subject, string typeKey, TimeSpan lookback, CancellationToken cancellationToken)
    {
        var newest = await clinicalEvents.ListNewestByTypesAsync(subject.Baby.Id, [typeKey], subject.Now - lookback, subject.Now + FutureSkew, RecentTake, cancellationToken);
        return newest.Select(typed => typed.Event).ToArray();
    }

    private static AssistantResult EndedAt(AssistantSubject subject, DateTimeOffset endedAt, Event? sleep) =>
        subject.Result(AssistantResultCode.SleepEnded) with
        {
            At = endedAt,
            Minutes = sleep is null ? null : WholeMinutes(EffectiveDuration.Of(sleep.StartedAt, sleep.EndedAt, sleep.Payload)),
        };

    private static AssistantVaccineDose DoseOf(DueDose dose) =>
        new(dose.VaccineKey, dose.VaccineNames.Values, dose.DoseLabel.Values, dose.State == Domain.Vaccinations.DoseState.Overdue, dose.DueOn);

    private static DateTimeOffset LocalMidnight(TimeZoneInfo zone, DateTimeOffset now)
    {
        var clock = LocalClock.InZone(zone);
        return clock.ToInstant(clock.DateOf(now).ToDateTime(TimeOnly.MinValue));
    }

    private static Guid IdOf(AssistantInvocation invocation, string command, AssistantSubject subject) =>
        AssistantEventIds.For(invocation.Adapter, invocation.RequestId, command, subject.Baby.Id);

    private static DateTimeOffset Later(DateTimeOffset first, DateTimeOffset second) => first > second ? first : second;

    private static double OneDecimal(double value) => Math.Round(value, 1, MidpointRounding.AwayFromZero);

    private static int? WholeMinutes(TimeSpan? duration) => duration is { } value ? (int)Math.Floor(value.TotalMinutes) : null;

    public Task<AssistantResult> LogBathAsync(AssistantInvocation invocation, decimal? temperatureC, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Bath, AssistantAccess.Log, subject => LogBathInnerAsync(invocation, subject, temperatureC, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogTummyTimeAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.TummyTime, AssistantAccess.Log, subject => LogTummyTimeInnerAsync(invocation, subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogBellyPainAsync(AssistantInvocation invocation, int intensity, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.BellyPain, AssistantAccess.Log, subject => LogBellyPainInnerAsync(invocation, subject, intensity, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogBreastPumpAsync(AssistantInvocation invocation, int? amountLeftMl, int? amountRightMl, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.BreastPump, AssistantAccess.Log, subject => LogBreastPumpInnerAsync(invocation, subject, amountLeftMl, amountRightMl, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogNasalSuctionAsync(AssistantInvocation invocation, string? tool, bool? saline, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.NasalSuction, AssistantAccess.Log, subject => LogNasalSuctionInnerAsync(invocation, subject, tool, saline, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogBellyMassageAsync(AssistantInvocation invocation, string? reason, string? helped, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.BellyMassage, AssistantAccess.Log, subject => LogBellyMassageInnerAsync(invocation, subject, reason, helped, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogFussyAsync(AssistantInvocation invocation, string? intensity, string? whatHelped, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Fussy, AssistantAccess.Log, subject => LogFussyInnerAsync(invocation, subject, intensity, whatHelped, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogNailTrimAsync(AssistantInvocation invocation, string? where, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.NailTrim, AssistantAccess.Log, subject => LogNailTrimInnerAsync(invocation, subject, where, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogTemperatureAsync(AssistantInvocation invocation, decimal valueC, string? method, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Temperature, AssistantAccess.Log, subject => LogTemperatureInnerAsync(invocation, subject, valueC, method, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogSpitUpAsync(AssistantInvocation invocation, string? kind, string? amount, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.SpitUp, AssistantAccess.Log, subject => LogSpitUpInnerAsync(invocation, subject, kind, amount, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogTeethingAsync(AssistantInvocation invocation, string? stage, string? tooth, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Teething, AssistantAccess.Log, subject => LogTeethingInnerAsync(invocation, subject, stage, tooth, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogMilestoneAsync(AssistantInvocation invocation, string? milestone, string? custom, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Milestone, AssistantAccess.Log, subject => LogMilestoneInnerAsync(invocation, subject, milestone, custom, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogSymptomAsync(AssistantInvocation invocation, string? symptom, string? severity, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Symptom, AssistantAccess.Log, subject => LogSymptomInnerAsync(invocation, subject, symptom, severity, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogOutdoorAsync(AssistantInvocation invocation, string? kind, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Outdoor, AssistantAccess.Log, subject => LogOutdoorInnerAsync(invocation, subject, kind, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogSkinCareAsync(AssistantInvocation invocation, string? product, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.SkinCare, AssistantAccess.Log, subject => LogSkinCareInnerAsync(invocation, subject, product, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogMedicationAsync(AssistantInvocation invocation, string medicationName, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Medication, AssistantAccess.Log, subject => LogMedicationInnerAsync(invocation, subject, medicationName, cancellationToken), cancellationToken);

    public Task<AssistantResult> ReadMedicationReminderAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.MedicationReminder, AssistantAccess.Read, subject => ReadMedicationReminderInnerAsync(subject, cancellationToken), cancellationToken);

    private async Task<AssistantResult> LogBathInnerAsync(AssistantInvocation invocation, AssistantSubject subject, decimal? temperatureC, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Bath, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.BathId, subject.Now, subject.Now, AssistantPayloads.Bath(temperatureC), cancellationToken);
        return subject.Result(AssistantResultCode.BathLogged) with { At = stored.StartedAt, TemperatureC = temperatureC };
    }

    private async Task<AssistantResult> LogTummyTimeInnerAsync(AssistantInvocation invocation, AssistantSubject subject, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.TummyTime, subject);
        if (await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken) is { } replayed)
        {
            return subject.Result(AssistantResultCode.TummyTimeStarted) with { At = replayed.StartedAt };
        }

        var created = await CreateAsync(subject, eventId, BuiltInEventTypes.TummyTimeId, subject.Now, endedAt: null, AssistantPayloads.TummyTime(), cancellationToken);
        return subject.Result(AssistantResultCode.TummyTimeStarted) with { At = created.StartedAt };
    }

    private async Task<AssistantResult> LogBellyPainInnerAsync(AssistantInvocation invocation, AssistantSubject subject, int intensity, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.BellyPain, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.BellyPainId, subject.Now, subject.Now, AssistantPayloads.BellyPain(intensity), cancellationToken);
        return subject.Result(AssistantResultCode.BellyPainLogged) with { At = stored.StartedAt, Intensity = intensity.ToString(System.Globalization.CultureInfo.InvariantCulture) };
    }

    private async Task<AssistantResult> LogBreastPumpInnerAsync(AssistantInvocation invocation, AssistantSubject subject, int? amountLeftMl, int? amountRightMl, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.BreastPump, subject);
        if (await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken) is { } replayed)
        {
            return subject.Result(AssistantResultCode.BreastPumpStarted) with { At = replayed.StartedAt };
        }

        var created = await CreateAsync(subject, eventId, BuiltInEventTypes.BreastPumpId, subject.Now, endedAt: null, AssistantPayloads.BreastPump(amountLeftMl, amountRightMl), cancellationToken);
        return subject.Result(AssistantResultCode.BreastPumpStarted) with { At = created.StartedAt };
    }

    private async Task<AssistantResult> LogNasalSuctionInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? tool, bool? saline, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.NasalSuction, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.NasalSuctionId, subject.Now, subject.Now, AssistantPayloads.NasalSuction(tool, saline), cancellationToken);
        return subject.Result(AssistantResultCode.NasalSuctionLogged) with { At = stored.StartedAt };
    }

    private async Task<AssistantResult> LogBellyMassageInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? reason, string? helped, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.BellyMassage, subject);
        if (await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken) is { } replayed)
        {
            return subject.Result(AssistantResultCode.BellyMassageStarted) with { At = replayed.StartedAt };
        }

        var created = await CreateAsync(subject, eventId, BuiltInEventTypes.BellyMassageId, subject.Now, endedAt: null, AssistantPayloads.BellyMassage(reason, helped), cancellationToken);
        return subject.Result(AssistantResultCode.BellyMassageStarted) with { At = created.StartedAt };
    }

    private async Task<AssistantResult> LogFussyInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? intensity, string? whatHelped, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Fussy, subject);
        if (await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken) is { } replayed)
        {
            return subject.Result(AssistantResultCode.FussyStarted) with { At = replayed.StartedAt };
        }

        var created = await CreateAsync(subject, eventId, BuiltInEventTypes.FussyId, subject.Now, endedAt: null, AssistantPayloads.Fussy(intensity, whatHelped), cancellationToken);
        return subject.Result(AssistantResultCode.FussyStarted) with { At = created.StartedAt, Intensity = intensity };
    }

    private async Task<AssistantResult> LogNailTrimInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? where, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.NailTrim, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.NailTrimId, subject.Now, subject.Now, AssistantPayloads.NailTrim(where), cancellationToken);
        return subject.Result(AssistantResultCode.NailTrimLogged) with { At = stored.StartedAt };
    }

    private async Task<AssistantResult> LogTemperatureInnerAsync(AssistantInvocation invocation, AssistantSubject subject, decimal valueC, string? method, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Temperature, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.TemperatureId, subject.Now, subject.Now, AssistantPayloads.Temperature(valueC, method), cancellationToken);
        return subject.Result(AssistantResultCode.TemperatureLogged) with { At = stored.StartedAt, TemperatureC = valueC };
    }

    private async Task<AssistantResult> LogSpitUpInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? kind, string? amount, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.SpitUp, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.SpitUpId, subject.Now, subject.Now, AssistantPayloads.SpitUp(kind, amount), cancellationToken);
        return subject.Result(AssistantResultCode.SpitUpLogged) with { At = stored.StartedAt };
    }

    private async Task<AssistantResult> LogTeethingInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? stage, string? tooth, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Teething, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.TeethingId, subject.Now, subject.Now, AssistantPayloads.Teething(stage, tooth), cancellationToken);
        return subject.Result(AssistantResultCode.TeethingLogged) with { At = stored.StartedAt };
    }

    private async Task<AssistantResult> LogMilestoneInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? milestone, string? custom, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Milestone, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.MilestoneId, subject.Now, subject.Now, AssistantPayloads.Milestone(milestone, custom), cancellationToken);
        return subject.Result(AssistantResultCode.MilestoneLogged) with { At = stored.StartedAt };
    }

    private async Task<AssistantResult> LogSymptomInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? symptom, string? severity, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Symptom, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.SymptomId, subject.Now, subject.Now, AssistantPayloads.Symptom(symptom, severity), cancellationToken);
        return subject.Result(AssistantResultCode.SymptomLogged) with { At = stored.StartedAt };
    }

    private async Task<AssistantResult> LogOutdoorInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? kind, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Outdoor, subject);
        if (await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken) is { } replayed)
        {
            return subject.Result(AssistantResultCode.OutdoorStarted) with { At = replayed.StartedAt };
        }

        var created = await CreateAsync(subject, eventId, BuiltInEventTypes.OutdoorId, subject.Now, endedAt: null, AssistantPayloads.Outdoor(kind), cancellationToken);
        return subject.Result(AssistantResultCode.OutdoorStarted) with { At = created.StartedAt };
    }

    private async Task<AssistantResult> LogSkinCareInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string? product, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.SkinCare, subject);
        var stored = await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken)
            ?? await CreateAsync(subject, eventId, BuiltInEventTypes.SkinCareId, subject.Now, subject.Now, AssistantPayloads.SkinCare(product), cancellationToken);
        return subject.Result(AssistantResultCode.SkinCareLogged) with { At = stored.StartedAt };
    }

    private async Task<AssistantResult> LogMedicationInnerAsync(AssistantInvocation invocation, AssistantSubject subject, string medicationName, CancellationToken cancellationToken)
    {
        var eventId = IdOf(invocation, AssistantCommands.Medication, subject);
        if (await events.FindForBabyAsync(subject.Baby.Id, eventId, cancellationToken) is { } replayed)
        {
            return subject.Result(AssistantResultCode.MedicationLogged) with { At = replayed.StartedAt };
        }

        var meds = await medications.ListForBabyAsync(subject.Baby.Id, cancellationToken);
        var med = meds.FirstOrDefault(m => string.Equals(m.Name, medicationName, StringComparison.OrdinalIgnoreCase));
        if (med is null)
        {
            return subject.Result(AssistantResultCode.NoActivePrescription);
        }

        var activePrescriptions = await prescriptions.ListForMedicationAsync(subject.Baby.Id, med.Id, cancellationToken);
        var today = DateOnly.FromDateTime(subject.Now.UtcDateTime);
var prescription = activePrescriptions.FirstOrDefault(p => !p.IsDeleted && p.CoversDay(today));
        if (prescription is null)
        {
            return subject.Result(AssistantResultCode.NoActivePrescription);
        }

        var payload = AssistantPayloads.Medication(med.Id, med.Name, prescription.Id, prescription.Dose.Amount, prescription.Dose.Unit);
        var created = await CreateAsync(subject, eventId, BuiltInEventTypes.MedicationId, subject.Now, subject.Now, payload, cancellationToken);
        return subject.Result(AssistantResultCode.MedicationLogged) with
        {
            At = created.StartedAt,
            PrescriptionId = prescription.Id,
        };
    }

    private async Task<AssistantResult> ReadMedicationReminderInnerAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var activePrescriptions = await prescriptions.ListActiveAsync(subject.Baby.Id, cancellationToken);
        if (activePrescriptions.Count == 0)
        {
            return subject.Result(AssistantResultCode.NoMedicationDue);
        }

        var doses = await medicationDoses.ListDosesAsync(subject.Baby.Id, subject.Now.AddDays(-30), cancellationToken);
        DateTimeOffset? nextDue = null;

        foreach (var prescription in activePrescriptions)
        {
            var lastDose = doses.FirstOrDefault(d => d.PrescriptionId == prescription.Id);
            var interval = prescription.Schedule.OwnInterval ?? TimeSpan.FromHours(8);
            var dueAt = lastDose is not null
                ? lastDose.GivenAt.Add(interval)
                : prescription.CreatedAt;

            if (dueAt <= subject.Now && (nextDue is null || dueAt < nextDue))
            {
                nextDue = dueAt;
            }
        }

        if (nextDue is null)
        {
            return subject.Result(AssistantResultCode.NoMedicationDue);
        }

        return subject.Result(AssistantResultCode.MedicationReminder) with
        {
            At = nextDue,
        };
    }

    }

/// <summary>The stable names of the assistant commands (logs and event id derivation; never change them).</summary>
internal static class AssistantCommands
{
    public const string SleepStart = "sleep_start";
    public const string SleepEnd = "sleep_end";
    public const string Bottle = "bottle";
    public const string Nursing = "nursing";
    public const string Diaper = "diaper";
    public const string LastFeed = "last_feed";
    public const string SleepStatus = "sleep_status";
    public const string DiapersToday = "diapers_today";
    public const string NextAppointment = "next_appointment";
    public const string DueVaccines = "due_vaccines";
    public const string ListBabies = "list_babies";
    public const string BabyProfile = "baby_profile";
    public const string DaySummary = "day_summary";
    public const string WeekSummary = "week_summary";
public const string NextNapWindow = "next_nap_window";
    public const string NextFeed = "next_feed";
    public const string NextDiaper = "next_diaper";
    public const string DiapersAverage = "diapers_average";
    public const string BottleAverage = "bottle_average";
    public const string SleepToday = "sleep_today";
    public const string LastDiaper = "last_diaper";
    public const string BottleToday = "bottle_today";
    public const string FeedsToday = "feeds_today";
    public const string CryReasons = "cry_reasons";
    public const string RequestDeleteLast = "request_delete_last";
    public const string Bath = "bath";
    public const string TummyTime = "tummy_time";
    public const string BellyPain = "belly_pain";
    public const string BreastPump = "breast_pump";
    public const string NasalSuction = "nasal_suction";
    public const string BellyMassage = "belly_massage";
    public const string Fussy = "fussy";
    public const string NailTrim = "nail_trim";
    public const string Temperature = "temperature";
    public const string SpitUp = "spit_up";
    public const string Teething = "teething";
    public const string Milestone = "milestone";
    public const string Symptom = "symptom";
    public const string Outdoor = "outdoor";
    public const string SkinCare = "skin_care";
    public const string Medication = "medication";
    public const string MedicationReminder = "medication_reminder";
    }
