namespace Lotties.Domain.Exceptions;

/// <summary>An event's end is earlier than its start.</summary>
public sealed class InvalidEventTimeRangeException : DomainException
{
    public InvalidEventTimeRangeException(DateTimeOffset startedAt, DateTimeOffset endedAt)
        : base("event_invalid_time_range", $"Event end ({endedAt:O}) must not be earlier than its start ({startedAt:O}).")
    {
        StartedAt = startedAt;
        EndedAt = endedAt;
    }

    public DateTimeOffset StartedAt { get; }

    public DateTimeOffset EndedAt { get; }
}
