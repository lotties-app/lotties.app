using Lotties.Domain.Common;

namespace Lotties.Domain.Professionals;

/// <summary>
/// A user's declaration that she is a healthcare professional (docs/design/16-doctor-access.md). Any user may declare
/// one; it is needed to join a baby as a Doctor. v1 is self-declared: <see cref="Verified"/> is always <c>false</c> (no
/// API sets it) and every screen shows "Self-declared" next to her name. One per user (the user id is the key).
/// </summary>
public sealed class ProfessionalProfile
{
    private ProfessionalProfile()
    {
    }

    private ProfessionalProfile(Guid userId, DateTimeOffset createdAt)
    {
        UserId = userId;
        CreatedAt = createdAt;
        UpdatedAt = createdAt;
    }

    public Guid UserId { get; private set; }

    public ProfessionalKind Kind { get; private set; }

    public string DisplayName { get; private set; } = string.Empty;

    public string? Specialty { get; private set; }

    public string? RegistrationNumber { get; private set; }

    /// <summary>Whether someone checked the registration. Always <c>false</c> in v1 (self-declared).</summary>
    public bool Verified { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public ProfessionalProfileTerms Terms => ProfessionalProfileTerms.Create(Kind, DisplayName, Specialty, RegistrationNumber);

    /// <summary>Declares a new, unverified profile for <paramref name="userId"/>.</summary>
    public static ProfessionalProfile Declare(Guid userId, ProfessionalProfileTerms terms, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(terms);
        var profile = new ProfessionalProfile(Ids.Required(userId, nameof(userId)), UtcTime.Normalize(now));
        profile.Apply(terms);
        return profile;
    }

    /// <summary>
    /// Applies the editable state. Equal terms change nothing (not even <see cref="UpdatedAt"/>). Editing never verifies
    /// the profile.
    /// </summary>
    public void Update(ProfessionalProfileTerms terms, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(terms);
        if (terms == Terms)
        {
            return;
        }

        Apply(terms);
        UpdatedAt = UtcTime.Normalize(now);
    }

    private void Apply(ProfessionalProfileTerms terms)
    {
        Kind = terms.Kind;
        DisplayName = terms.DisplayName;
        Specialty = terms.Specialty;
        RegistrationNumber = terms.RegistrationNumber;
    }
}
