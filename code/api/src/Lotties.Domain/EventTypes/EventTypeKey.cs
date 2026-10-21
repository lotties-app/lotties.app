using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.EventTypes;

/// <summary>Stable lower snake_case key of an event type, unique per baby (e.g. <c>tummy_time</c>).</summary>
public readonly record struct EventTypeKey
{
    public const int MaxLength = Slug.MaxLength;

    private EventTypeKey(string value)
    {
        Value = value;
    }

    public string Value { get; }

    public static EventTypeKey From(string? value)
    {
        if (!Slug.IsValid(value))
        {
            throw new DomainValidationException("Key", $"Event type key must be lower snake_case, start with a letter and be at most {MaxLength} characters.");
        }

        return new EventTypeKey(value!);
    }

    public override string ToString() => Value;
}
