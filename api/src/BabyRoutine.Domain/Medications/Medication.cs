using BabyRoutine.Domain.Common;

namespace BabyRoutine.Domain.Medications;

/// <summary>A medication in a baby's catalog. Usual medications are listed first when logging.</summary>
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

    public DateTimeOffset CreatedAt { get; private set; }

    public static Medication Create(Guid babyId, string name, Dosage? defaultDosage, string? notes, bool isUsual, DateTimeOffset createdAt)
    {
        var medication = new Medication(Guid.NewGuid(), Ids.Required(babyId, nameof(babyId)), UtcTime.Normalize(createdAt));
        medication.UpdateDetails(name, defaultDosage, notes);
        medication.IsUsual = isUsual;
        return medication;
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
