using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.EventTypes;

/// <summary>
/// Type-level rules of <see cref="EventFieldDefinition.VisibleWhen"/>: the referenced field exists in the same type, is a
/// select field, offers every listed value, and following the conditions never leads back to a field already visited.
/// </summary>
internal static class FieldVisibilityRules
{
    private const string Field = nameof(EventFieldDefinition.VisibleWhen);

    public static void EnsureValid(IReadOnlyList<EventFieldDefinition> fields)
    {
        var byKey = fields.ToDictionary(field => field.Key, StringComparer.Ordinal);
        var conditioned = fields.Where(field => field.VisibleWhen is not null).ToArray();
        Array.ForEach(conditioned, field => EnsureReferencesSelectOptions(field, byKey));
        Array.ForEach(conditioned, field => EnsureAcyclic(field, byKey));
    }

    private static void EnsureReferencesSelectOptions(EventFieldDefinition field, IReadOnlyDictionary<string, EventFieldDefinition> byKey)
    {
        var condition = field.VisibleWhen!;
        var controller = byKey.GetValueOrDefault(condition.Field)
            ?? throw new DomainValidationException(Field, $"Field '{field.Key}' depends on '{condition.Field}', which is not a field of the type.");
        if (controller.Kind != EventFieldKind.Select)
        {
            throw new DomainValidationException(Field, $"Field '{field.Key}' can only depend on a select field; '{controller.Key}' is {controller.Kind.ToString().ToLowerInvariant()}.");
        }

        var unknown = condition.Values.Where(value => !controller.Options.Contains(value, StringComparer.Ordinal)).ToArray();
        if (unknown.Length > 0)
        {
            throw new DomainValidationException(Field, $"Field '{field.Key}' depends on values that '{controller.Key}' does not offer: {string.Join(", ", unknown)}.");
        }
    }

    private static void EnsureAcyclic(EventFieldDefinition field, IReadOnlyDictionary<string, EventFieldDefinition> byKey)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal) { field.Key };
        var next = Controller(field, byKey);
        while (next is not null && visited.Add(next.Key))
        {
            next = Controller(next, byKey);
        }

        if (next is not null)
        {
            throw new DomainValidationException(Field, $"The visibility conditions of field '{field.Key}' form a cycle through '{next.Key}'.");
        }
    }

    private static EventFieldDefinition? Controller(EventFieldDefinition field, IReadOnlyDictionary<string, EventFieldDefinition> byKey) =>
        field.VisibleWhen is null ? null : byKey.GetValueOrDefault(field.VisibleWhen.Field);
}
