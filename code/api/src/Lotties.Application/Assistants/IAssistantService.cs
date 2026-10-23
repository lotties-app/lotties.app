using Lotties.Domain.Assistants;

namespace Lotties.Application.Assistants;

/// <summary>
/// The assistant command layer (docs/design/32-assistants.md): adapter-neutral commands and queries for voice assistants and
/// other adapters (Alexa today, an MCP server next). Each answers a language-neutral <see cref="AssistantResult"/>; the
/// adapter renders it. The user is the request's authenticated user; the baby is her assistant baby
/// (<see cref="AssistantBabyChoice"/>). Writes go through the normal event service (same validation, roles and idempotent
/// upsert, with an id derived from the request: <see cref="AssistantEventIds"/>) and need a role that logs events; reads
/// any family role. A Doctor is refused (<see cref="AssistantResultCode.NotAllowed"/>). There is no medication command:
/// assistants never log or read a dose, and never take free-text notes.
/// </summary>
public interface IAssistantService
{
    /// <summary>Starts a sleep timer (nap or night by the web's rule); refused when one already runs.</summary>
    Task<AssistantResult> LogSleepStartAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>Ends the running sleep (and any night waking) and logs the wake-up marker, as the web's Wake-up does.</summary>
    Task<AssistantResult> LogSleepEndAsync(AssistantInvocation invocation, CancellationToken cancellationToken = default);

    /// <summary>Logs a bottle given now (an instant, all of it drunk), of <paramref name="amountMl"/> ml.</summary>
    Task<AssistantResult> LogBottleAsync(AssistantInvocation invocation, int? amountMl, BottleKind kind, CancellationToken cancellationToken = default);

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
}
