namespace Lotties.Domain.Exceptions;

/// <summary>
/// Joining a baby as (or becoming) a Doctor needs a declared professional profile (<c>PUT /me/professional-profile</c>)
/// first. Nothing changed: an invite stays usable.
/// </summary>
public sealed class ProfessionalProfileRequiredException : DomainException
{
    public ProfessionalProfileRequiredException(Guid userId)
        : base("professional_profile_required", $"User {userId} has no professional profile; declare one before joining a baby as a doctor.")
    {
        UserId = userId;
    }

    public Guid UserId { get; }
}
