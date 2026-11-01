namespace Lotties.Domain.Exceptions;

/// <summary>An upsert addressed an existing vaccination record through a baby it does not belong to.</summary>
public sealed class VaccinationBabyMismatchException : DomainException
{
    public VaccinationBabyMismatchException(Guid vaccinationId, Guid requestedBabyId)
        : base("vaccination_baby_mismatch", $"Vaccination {vaccinationId} does not belong to baby {requestedBabyId}; a record cannot change baby.")
    {
        VaccinationId = vaccinationId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid VaccinationId { get; }

    public Guid RequestedBabyId { get; }
}
