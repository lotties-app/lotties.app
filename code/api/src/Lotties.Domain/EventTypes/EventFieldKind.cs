namespace Lotties.Domain.EventTypes;

/// <summary>Kind of a custom field on an event type (schema-lite).</summary>
public enum EventFieldKind
{
    Text,
    Number,
    Select,
    Bool,
}
