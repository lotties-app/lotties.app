using Lotties.Application.Clinical;
using Lotties.Application.Events;
using Lotties.Domain.Appointments;
using Lotties.Domain.Assistants;
using Lotties.Domain.Clinical;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Patterns;
using Lotties.Domain.Predictions;
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
    ILogger<AssistantService> logger) : IAssistantService
{
    private const string SleepKey = "sleep";
    private const string FeedingKey = "feeding";
    private const string DiaperKey = "diaper";
    private const int RecentTake = 100;

    private static readonly TimeSpan FutureSkew = Event.MaxClientClockSkew;
    private static readonly TimeSpan SleepLookback = TimeSpan.FromDays(30);
    private static readonly TimeSpan FeedingLookback = TimeSpan.FromDays(30);
    private static readonly TimeSpan NursingLookback = TimeSpan.FromDays(7);
    private static readonly TimeSpan AppointmentHorizon = TimeSpan.FromDays(366);
    private const int VaccinesTold = 5;

    public Task<AssistantResult> LogSleepStartAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.SleepStart, AssistantAccess.Log, subject => StartSleepAsync(invocation, subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogSleepEndAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.SleepEnd, AssistantAccess.Log, subject => EndSleepAsync(invocation, subject, cancellationToken), cancellationToken);

    public Task<AssistantResult> LogBottleAsync(AssistantInvocation invocation, int? amountMl, BottleKind kind, CancellationToken cancellationToken = default) =>
        RunAsync(invocation, AssistantCommands.Bottle, AssistantAccess.Log, subject => LogBottleAsync(invocation, subject, amountMl, kind, cancellationToken), cancellationToken);

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

    private async Task<AssistantResult> RunAsync(
        AssistantInvocation invocation,
        string command,
        AssistantAccess access,
        Func<AssistantSubject, Task<AssistantResult>> work,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(invocation);
        var lookup = await subjects.LoadAsync(invocation, access, cancellationToken);
        var result = lookup.Subject is { } subject ? await work(subject) : lookup.Refusal!;
        logger.LogInformation(
            "Assistant {Adapter} {Command} for baby {BabyId}: {ResultCode}",
            invocation.Adapter,
            command,
            result.Baby?.Id,
            AssistantResult.CodeName(result.Code));
        return result;
    }

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
            FormulaName = feed.FormulaName,
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
        var window = subject.Zone is null ? AssistantDayWindow.Last24Hours : AssistantDayWindow.Today;
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

    private async Task<AssistantResult> NextAppointmentAsync(AssistantSubject subject, CancellationToken cancellationToken)
    {
        var next = (await appointments.ListUpcomingAsync(subject.Baby.Id, subject.Now, subject.Now + AppointmentHorizon, cancellationToken)).FirstOrDefault();
        return next is null
            ? subject.Result(AssistantResultCode.NoAppointment)
            : subject.Result(AssistantResultCode.NextAppointment) with
            {
                At = next.StartsAt,
                Appointment = new AssistantAppointment(next.StartsAt, next.Title, next.Type.ToString().ToLowerInvariant()),
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
        var request = new UpsertEventRequest { TypeId = typeId, StartedAt = startedAt, EndedAt = endedAt, Payload = payload, UpdatedAt = subject.Now };
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
            Payload = AssistantPayloads.Stopped(running.Payload, running.StartedAt, endedAt),
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

    private static int? WholeMinutes(TimeSpan? duration) => duration is { } value ? (int)Math.Floor(value.TotalMinutes) : null;
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
}
