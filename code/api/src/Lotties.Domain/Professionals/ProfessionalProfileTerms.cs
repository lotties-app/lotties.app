using Lotties.Domain.Common;

namespace Lotties.Domain.Professionals;

/// <summary>What kind of healthcare professional a profile declares. v1 knows doctors only.</summary>
public enum ProfessionalKind
{
    /// <summary>A doctor (e.g. the baby's pediatrician).</summary>
    Doctor,
}

/// <summary>
/// The editable state of a professional profile: the name families see (required, at most 100 characters), an optional
/// specialty (100) and an optional registration number such as a CRM (40). Text is trimmed, blank optional text is
/// absent, NUL is rejected. Compared by value, so an unchanged save changes nothing.
/// </summary>
public sealed record ProfessionalProfileTerms
{
    public const int DisplayNameMaxLength = 100;
    public const int SpecialtyMaxLength = 100;
    public const int RegistrationNumberMaxLength = 40;

    private ProfessionalProfileTerms(ProfessionalKind kind, string displayName, string? specialty, string? registrationNumber)
    {
        Kind = kind;
        DisplayName = displayName;
        Specialty = specialty;
        RegistrationNumber = registrationNumber;
    }

    public ProfessionalKind Kind { get; }

    public string DisplayName { get; }

    public string? Specialty { get; }

    public string? RegistrationNumber { get; }

    /// <summary>Validates every rule; throws <see cref="Exceptions.DomainValidationException"/> naming the field.</summary>
    public static ProfessionalProfileTerms Create(ProfessionalKind kind, string? displayName, string? specialty, string? registrationNumber) =>
        new(
            kind,
            Text.Required(displayName, "displayName", DisplayNameMaxLength),
            Text.Optional(specialty, "specialty", SpecialtyMaxLength),
            Text.Optional(registrationNumber, "registrationNumber", RegistrationNumberMaxLength));
}
