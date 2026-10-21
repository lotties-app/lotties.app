namespace Lotties.Domain.Events;

/// <summary>How a client upsert applies to an existing event (see <see cref="Event.DecideUpsert"/>).</summary>
public enum EventUpsertDecision
{
    /// <summary>Apply the incoming details.</summary>
    Apply,

    /// <summary>The event is soft deleted; the upsert is a no-op and the deleted event is returned.</summary>
    IgnoreDeleted,

    /// <summary>The stored event changed after the client's edit; the upsert is a no-op and the stored event is returned.</summary>
    IgnoreStale,
}
