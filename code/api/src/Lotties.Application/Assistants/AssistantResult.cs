using System.Text.Json;
using System.Text.Json.Serialization;
using Lotties.Application.Clinical;
using Lotties.Application.Serialization;
using Lotties.Domain.Assistants;

namespace Lotties.Application.Assistants;

/// <summary>
/// The outcome of an assistant command, language-neutral (docs/design/32-assistants.md section 3): adapters render it in
/// their own words and language. Codes are stable; on the wire they are snake_case (<c>sleep_started</c>).
/// </summary>
[JsonConverter(typeof(SnakeCaseStringEnumConverter))]
public enum AssistantResultCode
{
    /// <summary>The caller's role on the baby does not allow the command (a Viewer writing, a Doctor anything).</summary>
    NotAllowed,

    /// <summary>The caller belongs to no baby.</summary>
    NoBaby,

    /// <summary>Several babies and no default: set one in the app (Settings, Voice assistants).</summary>
    ChooseBaby,

    /// <summary>Too many assistant requests from this user; nothing was done.</summary>
    RateLimited,

    /// <summary>The bottle amount is missing or outside <see cref="AssistantResult.Min"/>..<see cref="AssistantResult.Max"/> ml.</summary>
    InvalidAmount,

    /// <summary>A sleep timer started at <see cref="AssistantResult.At"/>.</summary>
    SleepStarted,

    /// <summary>A sleep timer already runs since <see cref="AssistantResult.At"/>; nothing was logged.</summary>
    SleepAlreadyRunning,

    /// <summary>The running sleep ended at <see cref="AssistantResult.At"/> after <see cref="AssistantResult.Minutes"/>.</summary>
    SleepEnded,

    /// <summary>No sleep timer runs; nothing was changed.</summary>
    NoRunningSleep,

    /// <summary><see cref="AssistantResult.Count"/> sleep timers run; nothing was changed (stop them in the app).</summary>
    SeveralRunningSleeps,

    /// <summary>A bottle was logged (<see cref="AssistantResult.AmountMl"/>, <see cref="AssistantResult.BottleKind"/>).</summary>
    BottleLogged,

    /// <summary>A nursing timer started on <see cref="AssistantResult.Side"/>.</summary>
    NursingStarted,

    /// <summary>A nursing timer already runs since <see cref="AssistantResult.At"/>; nothing was logged.</summary>
    NursingAlreadyRunning,

    /// <summary>A diaper was logged (<see cref="AssistantResult.Diaper"/>).</summary>
    DiaperLogged,

    /// <summary>The newest feeding: <see cref="AssistantResult.At"/> (start), method, amount, side, running.</summary>
    LastFeed,

    /// <summary>No feeding was logged recently.</summary>
    NoFeeds,

    /// <summary>The baby sleeps since <see cref="AssistantResult.At"/> (<see cref="AssistantResult.Minutes"/> so far).</summary>
    Sleeping,

    /// <summary>The baby is awake since <see cref="AssistantResult.At"/>; the last sleep lasted <see cref="AssistantResult.Minutes"/>.</summary>
    Awake,

    /// <summary>No sleep was logged recently.</summary>
    NoSleeps,

    /// <summary>Diapers of <see cref="AssistantResult.Window"/>: <see cref="AssistantResult.Count"/>, wet and dirty.</summary>
    DiapersToday,

    /// <summary>The next upcoming appointment (<see cref="AssistantResult.Appointment"/>).</summary>
    NextAppointment,

    /// <summary>No upcoming appointment.</summary>
    NoAppointment,

    /// <summary>Vaccine doses due or overdue by the schedule (<see cref="AssistantResult.Vaccines"/>); facts only.</summary>
    VaccinesDue,

    /// <summary>No vaccine dose is due or overdue.</summary>
    NoVaccinesDue,

    /// <summary>The named baby is not one of the user's (unknown, someone else's, or hers only as Doctor): list her babies first.</summary>
    UnknownBaby,

    /// <summary>The date is outside <see cref="AssistantResult.EarliestDate"/>..<see cref="AssistantResult.LatestDate"/>; nothing was read.</summary>
    InvalidDate,

    /// <summary>The babies the user may ask about (<see cref="AssistantResult.Babies"/>): her family memberships, never a Doctor's patients.</summary>
    Babies,

    /// <summary>The baby's name and age (<see cref="AssistantResult.Age"/>).</summary>
    BabyProfile,

    /// <summary>One local day's sleep, feeding and diaper counts and totals (<see cref="AssistantResult.Days"/>, one entry).</summary>
    DaySummary,

    /// <summary>Seven local days' sleep, feeding and diaper counts and totals (<see cref="AssistantResult.Days"/>, oldest first).</summary>
    WeekSummary,
}

/// <summary>Which days a count covers.</summary>
[JsonConverter(typeof(SnakeCaseStringEnumConverter))]
public enum AssistantDayWindow
{
    /// <summary>Since local midnight in <see cref="AssistantResult.TimeZone"/>.</summary>
    Today,

    /// <summary>The last 24 hours (no time zone is known for the user).</summary>
    LastDay,
}

/// <summary>The baby a result is about (her name from the profile).</summary>
public sealed record AssistantBaby(Guid Id, string Name);

/// <summary>An upcoming appointment as an answer tells it: when, its title (the family's own text) and its type code.</summary>
public sealed record AssistantAppointment(DateTimeOffset StartsAt, string Title, string Type);

/// <summary>A due vaccine dose (schedule facts): the vaccine's names and the dose label by language (<c>en</c>, <c>pt-BR</c>).</summary>
public sealed record AssistantVaccineDose(string VaccineKey, IReadOnlyDictionary<string, string> Names, IReadOnlyDictionary<string, string> DoseLabel, bool Overdue, DateOnly DueOn);

/// <summary>
/// A baby the user may ask about: its id and name, her role (<c>owner</c>, <c>parent</c>, <c>caregiver</c>, <c>viewer</c>),
/// whether she can log events for it, and whether it is the one commands use when no baby is named.
/// </summary>
public sealed record AssistantBabyAccess(Guid Id, string Name, string Role, bool CanLog, bool IsDefault);

/// <summary>A baby's age on the user's local date: whole days, whole weeks and whole calendar months since birth.</summary>
public sealed record AssistantBabyAge(int Days, int Weeks, int Months);

/// <summary>
/// One local day of the daily log, computed by the clinical summary's math (the parents' Insights rules,
/// <c>Lotties.Domain.Clinical</c>): sleep minutes inside the day (night and naps, the naps that started that day), the feeds
/// that started that day by method with the bottle ml logged, and the diapers (a mixed one counts as wet and dirty).
/// <see cref="Complete"/> is false for today (the day is not over).
/// </summary>
public sealed record AssistantDaySummary(DateOnly Date, bool Complete, SleepDayResponse Sleep, FeedingDayResponse Feeding, DiaperDayResponse Diapers);

/// <summary>
/// A language-neutral assistant answer: a <see cref="Code"/> and the facts it needs, never text to read. Instants are UTC;
/// <see cref="TimeZone"/> (IANA id) is the zone to tell local times in, <c>null</c> when the user's zone is unknown
/// (adapters then speak relative times). <see cref="AsOf"/> is when the command ran.
/// </summary>
public sealed record AssistantResult
{
    public required AssistantResultCode Code { get; init; }

    public required DateTimeOffset AsOf { get; init; }

    public AssistantBaby? Baby { get; init; }

    public string? TimeZone { get; init; }

    /// <summary>
    /// Where <see cref="TimeZone"/> came from, on the day-based summaries (<see cref="AssistantResultCode.DaySummary"/>,
    /// <see cref="AssistantResultCode.WeekSummary"/>, <see cref="AssistantResultCode.InvalidDate"/>), which always name the zone
    /// their days are in (<c>UTC</c> with <see cref="AssistantZoneSource.Utc"/> when none is known).
    /// </summary>
    [JsonConverter(typeof(SnakeCaseStringEnumConverter))]
    public AssistantZoneSource? TimeZoneSource { get; init; }

    public DateTimeOffset? At { get; init; }

    public DateTimeOffset? EndedAt { get; init; }

    public int? Minutes { get; init; }

    public bool? Running { get; init; }

    public int? AmountMl { get; init; }

    [JsonConverter(typeof(SnakeCaseStringEnumConverter))]
    public BottleKind? BottleKind { get; init; }

    public string? FormulaName { get; init; }

    [JsonConverter(typeof(SnakeCaseStringEnumConverter))]
    public FeedMethod? FeedMethod { get; init; }

    [JsonConverter(typeof(SnakeCaseStringEnumConverter))]
    public BreastSide? Side { get; init; }

    [JsonConverter(typeof(SnakeCaseStringEnumConverter))]
    public DiaperKind? Diaper { get; init; }

    public int? Count { get; init; }

    public int? Wet { get; init; }

    public int? Dirty { get; init; }

    public int? Overdue { get; init; }

    public int? Min { get; init; }

    public int? Max { get; init; }

    public AssistantDayWindow? Window { get; init; }

    public AssistantAppointment? Appointment { get; init; }

    public IReadOnlyList<AssistantVaccineDose> Vaccines { get; init; } = [];

    public IReadOnlyList<AssistantBabyAccess> Babies { get; init; } = [];

    public AssistantBabyAge? Age { get; init; }

    public IReadOnlyList<AssistantDaySummary> Days { get; init; } = [];

    /// <summary>The earliest date a summary may be asked for (with <see cref="AssistantResultCode.InvalidDate"/>).</summary>
    public DateOnly? EarliestDate { get; init; }

    /// <summary>The latest date a summary may be asked for: the user's today (with <see cref="AssistantResultCode.InvalidDate"/>).</summary>
    public DateOnly? LatestDate { get; init; }

    /// <summary>The stable wire name of <paramref name="code"/> (<c>sleep_started</c>), for logs and other adapters.</summary>
    public static string CodeName(AssistantResultCode code) => JsonNamingPolicy.SnakeCaseLower.ConvertName(code.ToString());
}
