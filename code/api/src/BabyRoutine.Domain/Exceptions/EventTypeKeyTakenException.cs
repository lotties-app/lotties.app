namespace BabyRoutine.Domain.Exceptions;

/// <summary>A custom event type key collides with a built-in type or another custom type of the baby.</summary>
public sealed class EventTypeKeyTakenException : DomainException
{
    public EventTypeKeyTakenException(Guid babyId, string key)
        : base("event_type_key_taken", $"Event type key '{key}' is already used for baby {babyId}.")
    {
        BabyId = babyId;
        Key = key;
    }

    public Guid BabyId { get; }

    public string Key { get; }
}
