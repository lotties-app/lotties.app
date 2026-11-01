namespace Lotties.Domain.Exceptions;

/// <summary>The user has not declared a professional profile.</summary>
public sealed class ProfessionalProfileNotFoundException : DomainException
{
    public ProfessionalProfileNotFoundException(Guid userId)
        : base("professional_profile_not_found", $"User {userId} has no professional profile.")
    {
        UserId = userId;
    }

    public Guid UserId { get; }
}
