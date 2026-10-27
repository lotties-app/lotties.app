using Lotties.Domain.Assistants;
using Lotties.Domain.Units;

namespace Lotties.Application.Assistants;

/// <summary>
/// The assistant command layer (docs/design/32-assistants.md): adapter-neutral commands and queries for voice assistants and
/// other adapters (Alexa and the MCP server). Each answers a language-neutral <see cref="AssistantResult"/>; the
/// adapter renders it. The user is the request's authenticated user; the baby is her assistant baby
/// (<see cref="AssistantBabyChoice"/>). Writes go through the normal event service (same validation, roles and idempotent
/// upsert, with an id derived from the request: <see cref="AssistantEventIds"/>) and need a role that logs events; reads
/// any family role. A Doctor is refused (<see cref="AssistantResultCode.NotAllowed"/>). Medication commands log doses
/// against active prescriptions and read reminders; they never advise or recommend.
/// </summary>
public interface IAssistantService
{
    /// <summary>Starts a sleep timer (nap or night by the web's rule); refused when one already runs.</summary>
    Task<AssistantResult> LogSleepStartAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>Ends the running sleep (and any night waking) and logs the wake-up marker, as the web's Wake-up does.</summary>
    Task<AssistantResult> LogSleepEndAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>Logs a bottle given now (an instant, all of it drunk), of <paramref name="amountMl"/> ml.</summary>
    Task<AssistantResult> LogBottleAsync(AssistantInvocation invocation, int? amountMl, BottleKind kind, CancellationToken cancellationToken = default);

    /// <summary>
    /// Logs a bottle given now from an amount in <paramref name="unit"/> (decimals allowed: "four and a half ounces"). Without a
    /// unit the amount is read in the user's unit system (<see cref="Units.IUnitPreferences"/>). It is converted to whole ml with
    /// the shared rule (<see cref="UnitConversions"/>) and then limited like <see cref="LogBottleAsync"/> (1-500 ml);
    /// storage is ml whatever was said.
    /// </summary>
    Task<AssistantResult> LogBottleVolumeAsync(AssistantInvocation invocation, decimal? amount, VolumeUnit? unit, BottleKind kind, CancellationToken cancellationToken = default);

    /// <summary>Starts a nursing timer on <paramref name="side"/>, else on the suggested side; refused when one already runs.</summary>
    Task<AssistantResult> LogNursingAsync(AssistantInvocation invocation, BreastSide? side, CancellationToken cancellationToken = default);

    /// <summary>Logs a diaper changed now.</summary>
    Task<AssistantResult> LogDiaperAsync(AssistantInvocation invocation, DiaperKind kind, CancellationToken cancellationToken = default);

    /// <summary>The newest feeding of the last 30 days.</summary>
    Task<AssistantResult> ReadLastFeedAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>Whether the baby sleeps (since when) or is awake (since when, and how long the last sleep lasted).</summary>
    Task<AssistantResult> ReadSleepStatusAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>Diapers since local midnight (the last 24 hours without a known time zone).</summary>
    Task<AssistantResult> ReadDiapersTodayAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>The next upcoming appointment within a year.</summary>
    Task<AssistantResult> ReadNextAppointmentAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>The vaccine doses due or overdue today by the shipped schedule (the vaccine status engine; facts only).</summary>
    Task<AssistantResult> ReadDueVaccinesAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>
    /// The babies the user may ask about (<see cref="AssistantResultCode.Babies"/>): her family memberships with her role,
    /// whether she can log for each, and which one commands use without a named baby. Never a baby she is only the Doctor of.
    /// <see cref="AssistantInvocation.BabyId"/> is ignored.
    /// </summary>
    Task<AssistantResult> ListBabiesAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>The baby's name and age on the user's local date (<see cref="AssistantResultCode.BabyProfile"/>); nothing else of the profile.</summary>
    Task<AssistantResult> ReadBabyProfileAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>
    /// One local day (<paramref name="date"/>, else today) of sleep, feeding and diapers, by the clinical summary's math
    /// (<see cref="AssistantResultCode.DaySummary"/>); a date in the future or more than a year back is
    /// <see cref="AssistantResultCode.InvalidDate"/>. Days are the user's local days (UTC days without a known zone).
    /// </summary>
    Task<AssistantResult> ReadDaySummaryAsync(AssistantInvocation invocation, DateOnly? date, CancellationToken cancellationToken = default);

    /// <summary>The seven local days ending with <paramref name="endDate"/> (else today), oldest first, as <see cref="ReadDaySummaryAsync"/> computes each.</summary>
    Task<AssistantResult> ReadWeekSummaryAsync(AssistantInvocation invocation, DateOnly? endDate, CancellationToken cancellationToken = default);

/// <summary>
    /// The next nap window the sleep prediction expects, by the Now screen's rules (<see cref="AssistantResultCode.NextNapWindow"/>),
    /// that the baby sleeps (<see cref="AssistantResultCode.NapWindowAsleep"/>, with the expected wake-up when the prediction has one),
    /// or that there is not enough history (<see cref="AssistantResultCode.NoNapPrediction"/>).
    /// </summary>
    Task<AssistantResult> ReadNextNapWindowAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>The next feed the feeding prediction expects (<see cref="AssistantResultCode.NextFeed"/>), or <see cref="AssistantResultCode.NoNextFeed"/>.</summary>
    Task<AssistantResult> ReadNextFeedAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>The next wet and dirty diaper the diaper predictions expect (<see cref="AssistantResultCode.NextDiaper"/>), or <see cref="AssistantResultCode.NoNextDiaper"/>.</summary>
    Task<AssistantResult> ReadNextDiaperAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>
    /// Diapers per day: the average of the complete local days of the last seven (today left out) that have diapers, to one
    /// decimal, with the wet and dirty split; at least three such days, else <see cref="AssistantResultCode.NoDiapersAverage"/>.
    /// </summary>
    Task<AssistantResult> ReadDiapersAverageAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>
    /// Facts about her own bottles, never a recommendation: the average and the last of her last five bottles with an amount
    /// (ml), when there are at least three in the last 14 days (<see cref="AssistantResultCode.BottleAverage"/>), else
    /// <see cref="AssistantResultCode.NoBottleData"/>.
    /// </summary>
    Task<AssistantResult> ReadBottleAverageAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>Sleep since local midnight, naps and night together with a running sleep counted until now, and the number of naps (<see cref="AssistantResultCode.SleepToday"/>).</summary>
    Task<AssistantResult> ReadSleepTodayAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>
    /// The bottles since local midnight (the last 24 hours without a known zone): how many, and the ml drunk by the shared
    /// drunk-amount rule (<see cref="Lotties.Domain.Events.BottleAmounts.DrunkMl"/>), with the formula and breast milk split
    /// (<see cref="AssistantResultCode.BottleToday"/>). Facts only.
    /// </summary>
    Task<AssistantResult> ReadBottleTodayAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>The feeds since local midnight (the last 24 hours without a known zone): the total and the bottle, breast and solid split (<see cref="AssistantResultCode.FeedsToday"/>).</summary>
    Task<AssistantResult> ReadFeedsTodayAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>The newest diaper of the last 30 days: when and what (<see cref="AssistantResultCode.LastDiaper"/>), or <see cref="AssistantResultCode.NoDiapers"/>.</summary>
    Task<AssistantResult> ReadLastDiaperAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>
    /// "Undo the last thing I logged": asks for the newest entry this adapter created in the last 30 minutes to be deleted
    /// (<see cref="AssistantResultCode.DeleteRequested"/>) by marking it (<c>delete_requested_via</c>, <c>delete_requested_at</c>).
    /// Nothing is deleted: the person approves or keeps it in the Lotties app. Asking twice changes nothing; none made by this
    /// adapter in that time is <see cref="AssistantResultCode.NoEntryToDelete"/>. Needs a role that logs events.
    /// </summary>
    Task<AssistantResult> RequestDeleteLastAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>
    /// "Why is she crying?": the top likely causes the baby's own log suggests, each with the logged fact behind it
    /// (<see cref="AssistantResultCode.CryReasons"/>), or that nothing in the log points at one (<see cref="AssistantResultCode.CryNoData"/>);
    /// always with the red flags to call the pediatrician for. Not a diagnosis, never a remedy or a dose.
    /// </summary>
    Task<AssistantResult> ReadCryReasonsAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>Logs a bath now, with optional water temperature.</summary>
    Task<AssistantResult> LogBathAsync(AssistantInvocation invocation, decimal? temperatureC, CancellationToken cancellationToken = default);

    /// <summary>Starts a tummy time timer now.</summary>
    Task<AssistantResult> LogTummyTimeAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>Logs belly pain with required intensity (1-5).</summary>
    Task<AssistantResult> LogBellyPainAsync(AssistantInvocation invocation, int intensity, CancellationToken cancellationToken = default);

    /// <summary>Starts a breast pump timer with optional left/right amounts.</summary>
    Task<AssistantResult> LogBreastPumpAsync(AssistantInvocation invocation, int? amountLeftMl, int? amountRightMl, CancellationToken cancellationToken = default);

    /// <summary>Logs nasal suction with optional tool and saline flag.</summary>
    Task<AssistantResult> LogNasalSuctionAsync(AssistantInvocation invocation, string? tool, bool? saline, CancellationToken cancellationToken = default);

    /// <summary>Starts a belly massage timer with optional reason and helped flag.</summary>
    Task<AssistantResult> LogBellyMassageAsync(AssistantInvocation invocation, string? reason, string? helped, CancellationToken cancellationToken = default);

    /// <summary>Starts a fussy/crying timer with optional intensity and what helped.</summary>
    Task<AssistantResult> LogFussyAsync(AssistantInvocation invocation, string? intensity, string? whatHelped, CancellationToken cancellationToken = default);

    /// <summary>Logs a nail trim with optional location.</summary>
    Task<AssistantResult> LogNailTrimAsync(AssistantInvocation invocation, string? where, CancellationToken cancellationToken = default);

    /// <summary>Logs a temperature reading (required value, optional method).</summary>
    Task<AssistantResult> LogTemperatureAsync(AssistantInvocation invocation, decimal valueC, string? method, CancellationToken cancellationToken = default);

    /// <summary>Logs spit-up or vomit with optional kind and amount.</summary>
    Task<AssistantResult> LogSpitUpAsync(AssistantInvocation invocation, string? kind, string? amount, CancellationToken cancellationToken = default);

    /// <summary>Logs a teething event with optional stage and tooth.</summary>
    Task<AssistantResult> LogTeethingAsync(AssistantInvocation invocation, string? stage, string? tooth, CancellationToken cancellationToken = default);

    /// <summary>Logs a milestone with optional type and custom text.</summary>
    Task<AssistantResult> LogMilestoneAsync(AssistantInvocation invocation, string? milestone, string? custom, CancellationToken cancellationToken = default);

    /// <summary>Logs a symptom with optional type and severity.</summary>
    Task<AssistantResult> LogSymptomAsync(AssistantInvocation invocation, string? symptom, string? severity, CancellationToken cancellationToken = default);

    /// <summary>Starts an outdoor time timer with optional kind.</summary>
    Task<AssistantResult> LogOutdoorAsync(AssistantInvocation invocation, string? kind, CancellationToken cancellationToken = default);

    /// <summary>Logs skin care with optional product.</summary>
    Task<AssistantResult> LogSkinCareAsync(AssistantInvocation invocation, string? product, CancellationToken cancellationToken = default);

    /// <summary>Logs a medication dose against an active prescription (resolved by medication name).</summary>
    Task<AssistantResult> LogMedicationAsync(AssistantInvocation invocation, string medicationName, CancellationToken cancellationToken = default);

    /// <summary>Reads the next due medication dose from active prescriptions.</summary>
    Task<AssistantResult> ReadMedicationReminderAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    }
