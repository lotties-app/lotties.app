using BabyRoutine.Domain.Medications;

namespace BabyRoutine.Application.Medications;

/// <summary>A dose amount with its unit, e.g. <c>{"amount":2.5,"unit":"ml"}</c>.</summary>
public sealed record DosageDto
{
    public required decimal Amount { get; init; }

    public required string Unit { get; init; }

    public static implicit operator DosageDto(Dosage dosage)
    {
        ArgumentNullException.ThrowIfNull(dosage);
        return new DosageDto { Amount = dosage.Amount, Unit = dosage.Unit };
    }

    /// <summary>Validates with the domain rules (positive amount, unit required); throws <see cref="Domain.Exceptions.DomainValidationException"/>.</summary>
    public static explicit operator Dosage(DosageDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        return Dosage.Create(dto.Amount, dto.Unit);
    }
}

/// <summary>A medication of a baby's catalog.</summary>
public sealed record MedicationResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public string Name { get; init; } = string.Empty;

    public DosageDto? DefaultDosage { get; init; }

    public string? Notes { get; init; }

    public bool IsUsual { get; init; }

    /// <summary>The shared catalog product this medication is linked to, if any.</summary>
    public Guid? ProductId { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public static implicit operator MedicationResponse(Medication medication)
    {
        ArgumentNullException.ThrowIfNull(medication);
        return new MedicationResponse
        {
            Id = medication.Id,
            BabyId = medication.BabyId,
            Name = medication.Name,
            DefaultDosage = medication.DefaultDosage is null ? null : (DosageDto)medication.DefaultDosage,
            Notes = medication.Notes,
            IsUsual = medication.IsUsual,
            ProductId = medication.ProductId,
            CreatedAt = medication.CreatedAt,
        };
    }
}

/// <summary>
/// Body of <c>PUT /api/v1/babies/{babyId}/medications/{medicationId}</c>: the full editable state. <see cref="Name"/> is
/// required unless <see cref="ProductId"/> links a catalog product, whose name is then used (the baby's own name, a
/// nickname, wins when given). Omitting <see cref="ProductId"/> removes the link.
/// </summary>
public sealed record UpsertMedicationRequest
{
    public string? Name { get; init; }

    public Guid? ProductId { get; init; }

    public DosageDto? DefaultDosage { get; init; }

    public string? Notes { get; init; }

    public bool IsUsual { get; init; }
}

/// <summary>The outcome of an upsert: the medication as stored, and whether this request created it.</summary>
public sealed record UpsertMedicationResult(MedicationResponse Medication, bool Created);
