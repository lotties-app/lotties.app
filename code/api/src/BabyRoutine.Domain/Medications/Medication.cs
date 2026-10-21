using BabyRoutine.Domain.Common;

namespace BabyRoutine.Domain.Medications;

/// <summary>
/// A medication in a baby's catalog. Usual medications are listed first when logging. It may be linked to a product of
/// the shared catalog (<see cref="ProductId"/>); the baby's own name (a nickname) stays the one shown.
/// </summary>
public sealed class Medication
{
    public const int NameMaxLength = 100;
    public const int NotesMaxLength = 1000;

    private Medication()
    {
    }

    private Medication(Guid id, Guid babyId, DateTimeOffset createdAt)
    {
        Id = id;
        BabyId = babyId;
        CreatedAt = createdAt;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    public string Name { get; private set; } = string.Empty;

    public Dosage? DefaultDosage { get; private set; }

    public string? Notes { get; private set; }

    public bool IsUsual { get; private set; }

    /// <summary>The shared catalog product this medication is, if the parent linked one.</summary>
    public Guid? ProductId { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public static Medication Create(Guid babyId, string name, Dosage? defaultDosage, string? notes, bool isUsual, DateTimeOffset createdAt) =>
        Create(Guid.NewGuid(), babyId, name, defaultDosage, notes, isUsual, createdAt);

    /// <summary>Creates a medication with a client-generated id, for idempotent upserts.</summary>
    public static Medication Create(Guid id, Guid babyId, string name, Dosage? defaultDosage, string? notes, bool isUsual, DateTimeOffset createdAt, Guid? productId = null)
    {
        var medication = new Medication(Ids.Required(id, nameof(id)), Ids.Required(babyId, nameof(babyId)), UtcTime.Normalize(createdAt));
        medication.UpdateDetails(name, defaultDosage, notes);
        medication.IsUsual = isUsual;
        medication.ProductId = productId;
        return medication;
    }

    /// <summary>The name to store: the requested one, or the linked product's name when none was given.</summary>
    public static string? NameOrProductName(string? requestedName, string? productName) =>
        string.IsNullOrWhiteSpace(requestedName) ? productName : requestedName;

    /// <summary>Applies the full editable state of the medication (details, the usual flag and the product link).</summary>
    public void Edit(string name, Dosage? defaultDosage, string? notes, bool isUsual, Guid? productId = null)
    {
        UpdateDetails(name, defaultDosage, notes);
        IsUsual = isUsual;
        ProductId = productId;
    }

    public void UpdateDetails(string name, Dosage? defaultDosage, string? notes)
    {
        var validatedName = Text.Required(name, nameof(Name), NameMaxLength);
        var validatedNotes = Text.Optional(notes, nameof(Notes), NotesMaxLength);
        Name = validatedName;
        Notes = validatedNotes;
        DefaultDosage = defaultDosage;
    }

    public void MarkAsUsual() => IsUsual = true;

    public void UnmarkAsUsual() => IsUsual = false;
}
