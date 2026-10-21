using System.Globalization;
using System.Text.Json;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.EventTypes;

/// <summary>
/// Checks an event payload against its type's field definitions. A member that is absent or JSON <c>null</c> has no
/// value. A field is hidden when its <see cref="EventFieldDefinition.VisibleWhen"/> is not met by the controlling
/// field's value, or the controlling field is hidden itself; a hidden field must hold no value and is never required.
/// A visible required field must hold a value once the event is complete (a running timer may still be filled in),
/// except bool fields, where no value means <c>false</c>. Values must match their kind: text a string, number a number
/// within <see cref="EventFieldDefinition.Min"/>/<see cref="EventFieldDefinition.Max"/>, select one of the options,
/// bool <c>true</c>/<c>false</c>. Members no field declares are not checked.
/// </summary>
internal static class EventPayloadFieldRules
{
    public static void Ensure(IReadOnlyList<EventFieldDefinition> fields, EventPayload payload, bool isComplete)
    {
        ArgumentNullException.ThrowIfNull(fields);
        if (fields.Count == 0)
        {
            return;
        }

        using var document = JsonDocument.Parse(payload.Value);
        var values = new PayloadValues(fields, document.RootElement);
        foreach (var field in fields)
        {
            EnsureField(field, values, isComplete);
        }
    }

    private static void EnsureField(EventFieldDefinition field, PayloadValues values, bool isComplete)
    {
        var value = values.Find(field.Key);
        var visible = values.IsVisible(field);
        if (value is null)
        {
            EnsureNotMissing(field, visible, isComplete);
            return;
        }

        EnsureVisible(field, visible);
        EnsureKind(field, value.Value);
    }

    private static void EnsureNotMissing(EventFieldDefinition field, bool visible, bool isComplete)
    {
        if (visible && isComplete && field.IsRequired && field.Kind != EventFieldKind.Bool)
        {
            throw new DomainValidationException(field.Key, $"'{field.Key}' is required.");
        }
    }

    private static void EnsureVisible(EventFieldDefinition field, bool visible)
    {
        if (!visible)
        {
            var condition = field.VisibleWhen!;
            throw new DomainValidationException(field.Key, $"'{field.Key}' applies only when '{condition.Field}' is {string.Join(" or ", condition.Values)}.");
        }
    }

    private static void EnsureKind(EventFieldDefinition field, JsonElement value)
    {
        Action<EventFieldDefinition, JsonElement> check = field.Kind switch
        {
            EventFieldKind.Text => EnsureText,
            EventFieldKind.Number => EnsureNumber,
            EventFieldKind.Select => EnsureOption,
            EventFieldKind.Bool => EnsureBool,
            _ => static (_, _) => { },
        };
        check(field, value);
    }

    private static void EnsureText(EventFieldDefinition field, JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new DomainValidationException(field.Key, $"'{field.Key}' must be text.");
        }
    }

    private static void EnsureBool(EventFieldDefinition field, JsonElement value)
    {
        if (value.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
        {
            throw new DomainValidationException(field.Key, $"'{field.Key}' must be true or false.");
        }
    }

    private static void EnsureOption(EventFieldDefinition field, JsonElement value)
    {
        var option = value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        if (option is null || !field.Options.Contains(option, StringComparer.Ordinal))
        {
            throw new DomainValidationException(field.Key, $"'{field.Key}' must be one of: {string.Join(", ", field.Options)}.");
        }
    }

    private static void EnsureNumber(EventFieldDefinition field, JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Number)
        {
            throw new DomainValidationException(field.Key, $"'{field.Key}' must be a number.");
        }

        var number = value.TryGetDouble(out var parsed) ? parsed : Overflowed(value);
        if (field.Min is { } min && number < (double)min)
        {
            throw new DomainValidationException(field.Key, $"'{field.Key}' must be at least {min.ToString(CultureInfo.InvariantCulture)}.");
        }

        if (field.Max is { } max && number > (double)max)
        {
            throw new DomainValidationException(field.Key, $"'{field.Key}' must be at most {max.ToString(CultureInfo.InvariantCulture)}.");
        }
    }

    /// <summary>A number too large for a double, as the infinity of its sign so range checks still apply.</summary>
    private static double Overflowed(JsonElement value) =>
        value.GetRawText().StartsWith('-') ? double.NegativeInfinity : double.PositiveInfinity;

    /// <summary>The payload members the fields declare, and which fields are visible given them.</summary>
    private sealed class PayloadValues
    {
        private readonly Dictionary<string, EventFieldDefinition> _fields;
        private readonly Dictionary<string, JsonElement> _values = new(StringComparer.Ordinal);

        public PayloadValues(IReadOnlyList<EventFieldDefinition> fields, JsonElement root)
        {
            _fields = fields.DistinctBy(field => field.Key, StringComparer.Ordinal).ToDictionary(field => field.Key, StringComparer.Ordinal);
            var members = root.ValueKind == JsonValueKind.Object ? root.EnumerateObject().ToArray() : [];
            foreach (var member in members.Where(member => _fields.ContainsKey(member.Name) && member.Value.ValueKind != JsonValueKind.Null))
            {
                _values[member.Name] = member.Value;
            }
        }

        public JsonElement? Find(string key) => _values.TryGetValue(key, out var value) ? value : null;

        /// <remarks>
        /// A condition naming no field of the type does not hide anything; following conditions stops after as many steps
        /// as there are fields, so even a cyclic definition read back from storage cannot loop.
        /// </remarks>
        public bool IsVisible(EventFieldDefinition field) => IsVisible(field, _fields.Count);

        private bool IsVisible(EventFieldDefinition field, int remainingSteps)
        {
            var controller = field.VisibleWhen is null ? null : _fields.GetValueOrDefault(field.VisibleWhen.Field);
            return controller is null
                || (remainingSteps > 0
                    && field.VisibleWhen!.IsMetBy(SelectedOption(controller.Key))
                    && IsVisible(controller, remainingSteps - 1));
        }

        private string? SelectedOption(string key) =>
            _values.TryGetValue(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }
}
