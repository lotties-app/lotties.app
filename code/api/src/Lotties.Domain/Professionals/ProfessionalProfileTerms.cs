using Lotties.Domain.Common;

namespace Lotties.Domain.Professionals;

/// <summary>What kind of healthcare professional a profile declares. v1 knows doctors only.</summary>
public enum ProfessionalKind
{
    /// <summary>A doctor (e.g. the baby's pediatrician).</summary>
    Doctor,
}

/// <summary>
/// The editable state of a professional profile: the specialty (the only required field, at most 100 characters; a
/// <c>DoctorSpecialties</c> code when it matches), an optional name (100) and an optional registration number such as a
/// CRM (40), each shown to families only when its share flag is on (docs/design/45-privacy-first-onboarding.md). Text is trimmed, blank optional text is
/// absent, NUL is rejected. Compared by value, so an unchanged save changes nothing.
/// </summary>
public sealed record ProfessionalProfileTerms
{
    public const int DisplayNameMaxLength = 100;
    public const int SpecialtyMaxLength = 100;
    public const int RegistrationNumberMaxLength = 40;

    private ProfessionalProfileTerms(ProfessionalKind kind, string displayName, string specialty, string? registrationNumber, bool shareDisplayName, bool shareRegistration)
    {
        Kind = kind;
        DisplayName = displayName;
        Specialty = specialty;
        RegistrationNumber = registrationNumber;
        ShareDisplayName = shareDisplayName && displayName.Length > 0;
        ShareRegistration = shareRegistration && registrationNumber is not null;
    }

    public ProfessionalKind Kind { get; }

    public string DisplayName { get; }

    public string Specialty { get; }

    public string? RegistrationNumber { get; }

    public bool ShareDisplayName { get; }

    public bool ShareRegistration { get; }

    /// <summary>Validates every rule; throws <see cref="Exceptions.DomainValidationException"/> naming the field.</summary>
    public static ProfessionalProfileTerms Create(ProfessionalKind kind, string? displayName, string? specialty, string? registrationNumber, bool shareDisplayName = false, bool shareRegistration = false) =>
        new(
            kind,
            Text.Optional(displayName, "displayName", DisplayNameMaxLength) ?? string.Empty,
            Text.Required(specialty, "specialty", SpecialtyMaxLength),
            Text.Optional(registrationNumber, "registrationNumber", RegistrationNumberMaxLength),
            shareDisplayName,
            shareRegistration);
}
