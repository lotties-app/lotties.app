namespace Lotties.Domain.Exceptions;

/// <summary>An upsert addressed an existing care provider through a baby it does not belong to.</summary>
public sealed class CareProviderBabyMismatchException : DomainException
{
    public CareProviderBabyMismatchException(Guid providerId, Guid requestedBabyId)
        : base("care_provider_baby_mismatch", $"Care provider {providerId} does not belong to baby {requestedBabyId}; a provider cannot change baby.")
    {
        ProviderId = providerId;
        RequestedBabyId = requestedBabyId;
    }

    public Guid ProviderId { get; }

    public Guid RequestedBabyId { get; }
}
