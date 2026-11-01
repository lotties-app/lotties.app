namespace Lotties.Domain.Exceptions;

/// <summary>No care provider with the id exists for the baby.</summary>
public sealed class CareProviderNotFoundException : DomainException
{
    public CareProviderNotFoundException(Guid babyId, Guid providerId)
        : base("care_provider_not_found", $"Care provider {providerId} was not found for baby {babyId}.")
    {
        BabyId = babyId;
        ProviderId = providerId;
    }

    public Guid BabyId { get; }

    public Guid ProviderId { get; }
}
