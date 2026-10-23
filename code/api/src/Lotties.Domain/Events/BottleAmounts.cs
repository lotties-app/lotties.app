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

    /// <summary>
    /// What the baby drank (ml), as the web's <c>drunkMl</c> reads it: the drunk amount (never above the prepared one), else the
    /// prepared amount (a bottle without a drunk value was fully drunk: old bottles keep their totals), else the drunk amount
    /// alone; <c>null</c> without either. Only finite, non-negative numbers count. Every server total of bottle ml (clinical
    /// summary, assistants) reads it.
    /// </summary>
    public static double? DrunkMl(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var prepared = Amount(root, PreparedMember);
        var drunk = Amount(root, DrunkMember);
        return drunk is { } drank && prepared is { } made ? Math.Min(drank, made) : drunk ?? prepared;
    }

    private static double? Amount(JsonElement root, string key) =>
        TryNumber(root, key, out var value) && double.IsFinite(value) && value >= 0 ? value : null;

    private static bool TryNumber(JsonElement root, string key, out double value)
    {
        value = 0;
        return root.TryGetProperty(key, out var member) && member.ValueKind == JsonValueKind.Number && member.TryGetDouble(out value);
    }
}
