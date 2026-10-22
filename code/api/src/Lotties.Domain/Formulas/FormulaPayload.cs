using System.Text.Json;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Formulas;

/// <summary>
/// The formula members of the built-in feeding payload: <c>formula_id</c> (a GUID string naming a formula of the same
/// baby, archived ones included so bottles logged offline before an archive still sync) and <c>formula_name</c> (a copy of
/// the formula's name when the bottle was logged, at most 60 characters, so history keeps the name after a rename or an
/// archive). Both are hidden fields shown only for a bottle of formula (the field rules of the type check that); a
/// member that is absent or <c>null</c> has no value. Older payloads and the Napper importer's have neither and stay valid.
/// </summary>
public static class FormulaPayload
{
    public const string FormulaIdMember = "formula_id";
    public const string FormulaNameMember = "formula_name";

    /// <summary>
    /// Checks the shape of both members and returns the referenced formula id, if any; throws
    /// <see cref="DomainValidationException"/> with the member as field.
    /// </summary>
    public static Guid? CheckReference(EventPayload payload)
    {
        using var document = JsonDocument.Parse(payload.Value);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        EnsureName(root);
        return ReadId(root);
    }

    /// <summary>The referenced formula must exist and belong to <paramref name="babyId"/>; else <see cref="DomainValidationException"/>.</summary>
    public static void EnsureReferenceValid(Guid babyId, Guid formulaId, Formula? found)
    {
        if (found is null || found.Id != formulaId || found.BabyId != babyId)
        {
            throw new DomainValidationException(FormulaIdMember, $"{FormulaIdMember} must be a formula of this baby.");
        }
    }

    private static Guid? ReadId(JsonElement root)
    {
        if (!root.TryGetProperty(FormulaIdMember, out var member) || member.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return member.ValueKind == JsonValueKind.String && Guid.TryParse(member.GetString(), out var id) && id != Guid.Empty
            ? id
            : throw new DomainValidationException(FormulaIdMember, $"{FormulaIdMember} must be a GUID string.");
    }

    private static void EnsureName(JsonElement root)
    {
        if (root.TryGetProperty(FormulaNameMember, out var member) && member.ValueKind == JsonValueKind.String && member.GetString()!.Length > FormulaTerms.NameMaxLength)
        {
            throw new DomainValidationException(FormulaNameMember, $"{FormulaNameMember} must be at most {FormulaTerms.NameMaxLength} characters.");
        }
    }
}
