using System.Text.Json;

namespace BabyRoutine.Domain.Events;

/// <summary>
/// Structural JSON equality: object member order and whitespace are ignored, array order matters, numbers compare
/// by value. A storage round trip (PostgreSQL <c>jsonb</c> reorders keys and strips whitespace) keeps values equivalent.
/// </summary>
internal static class JsonEquivalence
{
    public static bool AreEquivalent(JsonElement left, JsonElement right) =>
        left.ValueKind == right.ValueKind && left.ValueKind switch
        {
            JsonValueKind.Object => ObjectsAreEquivalent(left, right),
            JsonValueKind.Array => ArraysAreEquivalent(left, right),
            JsonValueKind.Number => NumbersAreEqual(left, right),
            JsonValueKind.String => string.Equals(left.GetString(), right.GetString(), StringComparison.Ordinal),
            _ => true,
        };

    private static bool ObjectsAreEquivalent(JsonElement left, JsonElement right)
    {
        var leftMembers = MembersByName(left);
        var rightMembers = MembersByName(right);
        return leftMembers.Count == rightMembers.Count
            && leftMembers.All(member => rightMembers.TryGetValue(member.Key, out var other) && AreEquivalent(member.Value, other));
    }

    private static bool ArraysAreEquivalent(JsonElement left, JsonElement right) =>
        left.GetArrayLength() == right.GetArrayLength()
        && left.EnumerateArray().Zip(right.EnumerateArray()).All(pair => AreEquivalent(pair.First, pair.Second));

    private static bool NumbersAreEqual(JsonElement left, JsonElement right) =>
        left.TryGetDecimal(out var leftValue) && right.TryGetDecimal(out var rightValue)
            ? leftValue == rightValue
            : string.Equals(left.GetRawText(), right.GetRawText(), StringComparison.Ordinal);

    /// <summary>Members keyed by name; a repeated name keeps its last value, as <c>jsonb</c> does.</summary>
    private static Dictionary<string, JsonElement> MembersByName(JsonElement element)
    {
        var members = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var member in element.EnumerateObject())
        {
            members[member.Name] = member.Value;
        }

        return members;
    }
}
