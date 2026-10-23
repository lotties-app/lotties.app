using System.Text.Json;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Events;

/// <summary>
/// The two amounts of a bottle feeding (docs/design/20-feeding-amounts.md): <c>amount_ml</c> is what was prepared and
/// <c>amount_drunk_ml</c> what the baby drank. The drunk amount is optional; a bottle without it (every bottle logged
/// before it existed) counts as fully drunk. Drunk can never be above prepared. Also names the <c>ended_by</c> marker
/// a feeding timer gets when a starting sleep stops it.
/// </summary>
public static class BottleAmounts
{
    public const string PreparedMember = "amount_ml";
    public const string DrunkMember = "amount_drunk_ml";
    public const string EndedByMember = "ended_by";
    public const string EndedBySleep = "sleep";

    /// <summary>Throws <see cref="DomainValidationException"/> (field <c>amount_drunk_ml</c>) when both amounts are numbers and drunk is above prepared.</summary>
    public static void EnsureDrunkWithinPrepared(EventPayload payload)
    {
        using var document = JsonDocument.Parse(payload.Value);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || !TryNumber(root, PreparedMember, out var prepared)
            || !TryNumber(root, DrunkMember, out var drunk))
        {
            return;
        }

        if (drunk > prepared)
        {
            throw new DomainValidationException(DrunkMember, $"{DrunkMember} must not be above {PreparedMember}.");
        }
    }

    private static bool TryNumber(JsonElement root, string key, out double value)
    {
        value = 0;
        return root.TryGetProperty(key, out var member) && member.ValueKind == JsonValueKind.Number && member.TryGetDouble(out value);
    }
}
