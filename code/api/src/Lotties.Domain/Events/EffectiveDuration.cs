namespace Lotties.Domain.Events;

/// <summary>
/// How long a finished event really lasted: <c>(end - start) - paused_seconds</c>, never below zero (see
/// <see cref="PauseFields"/>). Events without pause keys keep their plain duration. Pure arithmetic on instants, so a
/// session across midnight (or a DST change) needs no special handling.
/// </summary>
public static class EffectiveDuration
{
    public static TimeSpan Of(DateTimeOffset startedAt, DateTimeOffset endedAt, TimeSpan paused)
    {
        var effective = endedAt - startedAt - (paused > TimeSpan.Zero ? paused : TimeSpan.Zero);
        return effective > TimeSpan.Zero ? effective : TimeSpan.Zero;
    }

    /// <summary>The effective duration of a finished event, or <c>null</c> while it runs.</summary>
    public static TimeSpan? Of(DateTimeOffset startedAt, DateTimeOffset? endedAt, EventPayload payload) =>
        endedAt is null ? null : Of(startedAt, endedAt.Value, EventPayloadFacts.Read(payload).Paused);
}
