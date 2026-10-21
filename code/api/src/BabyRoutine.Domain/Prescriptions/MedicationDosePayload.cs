using System.Text.Json;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Prescriptions;

/// <summary>One medication given, read from a medication event: <see cref="GivenAt"/> is the event start.</summary>
public sealed record MedicationDose(DateTimeOffset GivenAt, Guid? MedicationId, Guid? PrescriptionId, bool Override);

/// <summary>A prescription referenced by entry <see cref="Index"/> of a medication payload, with the entry's medication id.</summary>
public sealed record PrescriptionReference(int Index, Guid PrescriptionId, Guid? MedicationId)
{
    public string Field => $"medications[{Index}].prescriptionId";
}

/// <summary>
/// The medication event payload <c>{"medications":[{"medicationId","name","dose"?,"prescriptionId"?,"kgUsed"?,"override"?}]}</c>.
/// Older payloads (and the Napper importer's) have no <c>prescriptionId</c>/<c>kgUsed</c>/<c>override</c> and stay valid;
/// only those three members are checked, and only when present and not null: <c>prescriptionId</c> a GUID string,
/// <c>override</c> a boolean, <c>kgUsed</c> a number greater than 0 and at most 1000. Members, entries or payloads of
/// another shape are left alone (as before).
/// </summary>
public static class MedicationDosePayload
{
    public const string MedicationsMember = "medications";
    public const string MedicationIdMember = "medicationId";
    public const string PrescriptionIdMember = "prescriptionId";
    public const string OverrideMember = "override";
    public const string KgUsedMember = "kgUsed";
    public const decimal MaxKgUsed = 1000m;

    /// <summary>The doses of a stored payload, tolerating any shape (entries without a usable id keep <c>null</c>).</summary>
    public static IReadOnlyList<MedicationDose> ReadDoses(EventPayload payload, DateTimeOffset givenAt)
    {
        using var document = JsonDocument.Parse(payload.Value);
        return Entries(document.RootElement)
            .Select(entry => new MedicationDose(givenAt, GuidMember(entry, MedicationIdMember), GuidMember(entry, PrescriptionIdMember), entry.TryGetProperty(OverrideMember, out var flag) && flag.ValueKind == JsonValueKind.True))
            .ToArray();
    }

    /// <summary>
    /// Checks the members added for prescriptions (see the type remarks) and returns the referenced prescriptions;
    /// throws <see cref="DomainValidationException"/> with a field such as <c>medications[0].override</c>.
    /// </summary>
    public static IReadOnlyList<PrescriptionReference> CheckExtensions(EventPayload payload)
    {
        using var document = JsonDocument.Parse(payload.Value);
        return Entries(document.RootElement)
            .Select((entry, index) => CheckEntry(entry, index))
            .OfType<PrescriptionReference>()
            .ToArray();
    }

    /// <summary>
    /// Every reference must name a prescription of <paramref name="babyId"/> (soft-deleted ones included, so doses logged
    /// offline before a delete still sync) for the same medication as the entry; else <see cref="DomainValidationException"/>.
    /// </summary>
    public static void EnsureReferencesValid(Guid babyId, IReadOnlyList<PrescriptionReference> references, IReadOnlyList<Prescription> found)
    {
        ArgumentNullException.ThrowIfNull(references);
        ArgumentNullException.ThrowIfNull(found);
        var byId = found.Where(prescription => prescription.BabyId == babyId).ToDictionary(prescription => prescription.Id);
        var invalid = references.FirstOrDefault(reference => !byId.TryGetValue(reference.PrescriptionId, out var prescription) || prescription.MedicationId != reference.MedicationId);
        if (invalid is not null)
        {
            throw new DomainValidationException(invalid.Field, $"{invalid.Field} must be a prescription of this baby for the entry's medicationId.");
        }
    }

    private static IEnumerable<JsonElement> Entries(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty(MedicationsMember, out var medications) && medications.ValueKind == JsonValueKind.Array
            ? medications.EnumerateArray().Where(entry => entry.ValueKind == JsonValueKind.Object).ToArray()
            : [];

    private static PrescriptionReference? CheckEntry(JsonElement entry, int index)
    {
        EnsureKind(entry, OverrideMember, index, kind => kind is JsonValueKind.True or JsonValueKind.False, "a boolean");
        EnsureKind(entry, KgUsedMember, index, _ => IsValidKg(entry.GetProperty(KgUsedMember)), $"a number greater than 0 and at most {MaxKgUsed}");
        if (!entry.TryGetProperty(PrescriptionIdMember, out var member) || member.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        return member.ValueKind == JsonValueKind.String && Guid.TryParse(member.GetString(), out var prescriptionId) && prescriptionId != Guid.Empty
            ? new PrescriptionReference(index, prescriptionId, GuidMember(entry, MedicationIdMember))
            : throw new DomainValidationException($"medications[{index}].{PrescriptionIdMember}", "prescriptionId must be a GUID string.");
    }

    private static void EnsureKind(JsonElement entry, string member, int index, Func<JsonValueKind, bool> isValid, string expected)
    {
        if (entry.TryGetProperty(member, out var value) && value.ValueKind != JsonValueKind.Null && !isValid(value.ValueKind))
        {
            throw new DomainValidationException($"medications[{index}].{member}", $"{member} must be {expected}.");
        }
    }

    private static bool IsValidKg(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var kg) && kg > 0 && kg <= MaxKgUsed;

    private static Guid? GuidMember(JsonElement entry, string member) =>
        entry.TryGetProperty(member, out var value) && value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out var id) ? id : null;
}
