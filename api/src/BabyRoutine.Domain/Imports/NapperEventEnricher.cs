using System.Text.Json.Nodes;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Imports;

/// <summary>
/// One already imported event the import fills in: its payload as planned (<see cref="ExpectedPayload"/>, so a change
/// made meanwhile is detected), the payload with the filled fields and their keys.
/// </summary>
public sealed record EventEnrichment(Guid EventId, EventPayload ExpectedPayload, EnrichedPayload Enriched, DateTimeOffset EnrichedAt);

/// <summary>The enriched payload and the keys it filled, in <see cref="NapperEventEnricher.EnrichableFields"/> order.</summary>
public sealed record EnrichedPayload(EventPayload Payload, IReadOnlyList<string> FilledFields);

/// <summary>
/// "Enrich existing events": for rows whose deterministic id already exists, copies only the detail and pause fields
/// (<see cref="EnrichableFields"/>) the stored event has no value for (absent or <c>null</c>), never overwriting a value
/// a parent entered and never touching times, type, notes, other payload members or soft-deleted events. Each field is
/// added only when the stored event still passes its type's payload rules with it (e.g. sleep details are skipped when
/// the event's kind was changed to one they do not apply to). A stored event whose type differs from the row's is left
/// alone. Running the same file again plans nothing.
/// </summary>
public static class NapperEventEnricher
{
    public static IReadOnlyList<string> EnrichableFields { get; } = Array.AsReadOnly(
        [.. SleepDetailFields.All, PauseFields.PauseCount, PauseFields.PausedSeconds]);

    /// <param name="alreadyImported">Candidates whose id already exists.</param>
    /// <param name="stored">The stored events of those ids (deleted ones are ignored).</param>
    /// <param name="now">The enrichment time (server clock).</param>
    public static IReadOnlyList<EventEnrichment> Plan(
        IReadOnlyList<NapperEventCandidate> alreadyImported,
        IReadOnlyList<Event> stored,
        DateTimeOffset now,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(alreadyImported);
        ArgumentNullException.ThrowIfNull(stored);
        var byId = stored.Where(item => !item.IsDeleted).ToDictionary(item => item.Id);
        return alreadyImported
            .Select(candidate => Enrich(candidate.Event, byId.GetValueOrDefault(candidate.Event.Id), now, cancellationToken))
            .OfType<EventEnrichment>()
            .ToArray();
    }

    private static EventEnrichment? Enrich(Event imported, Event? existing, DateTimeOffset now, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var type = existing is not null && existing.TypeId == imported.TypeId ? BuiltInEventTypes.All.FirstOrDefault(item => item.Id == existing.TypeId) : null;
        if (type is null)
        {
            return null;
        }

        var source = (JsonNode.Parse(imported.Payload.Value) as JsonObject) ?? [];
        var filled = EnrichableFields.Aggregate(
            new EnrichedPayload(existing!.Payload, []),
            (state, key) => TryFill(state, key, source[key], type, existing));
        return filled.FilledFields.Count == 0 ? null : new EventEnrichment(existing.Id, existing.Payload, filled, now);
    }

    private static EnrichedPayload TryFill(EnrichedPayload state, string key, JsonNode? value, EventType type, Event existing)
    {
        var target = (JsonNode.Parse(state.Payload.Value) as JsonObject) ?? [];
        if (value is null || target[key] is not null)
        {
            return state;
        }

        target[key] = value.DeepClone();
        return TryValidate(state, key, target.ToJsonString(), type, existing);
    }

    private static EnrichedPayload TryValidate(EnrichedPayload state, string key, string json, EventType type, Event existing)
    {
        try
        {
            var payload = EventPayload.From(json);
            type.EnsureValidPayload(payload, existing.StartedAt, existing.EndedAt);
            return new EnrichedPayload(payload, [.. state.FilledFields, key]);
        }
        catch (DomainException)
        {
            return state;
        }
    }
}
