using System.Text.RegularExpressions;
using Lotties.Domain.Common;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.CareProviders;

/// <summary>
/// The full editable state of one entry of a baby's directory of care providers (docs/design/22-care-providers.md):
/// name (required, 80), specialty (free text, 60; the app only suggests common ones), the professional registration as
/// three free texts (council 20, number 30, region 10; no format is enforced), clinic or hospital name (120), address
/// (400, multi-line), phone (30), WhatsApp (30), email (120), website (200), notes (1000), favorite and deleted flags.
/// Text is trimmed, blank optional text is absent, NUL is rejected. A website that names a scheme must name
/// <c>http</c> or <c>https</c> (it becomes a link). Contact details only: health information belongs in the baby's own
/// records, not here. Compared by value, so an idempotent replay changes nothing.
/// </summary>
public sealed partial record CareProviderTerms
{
    public const int NameMaxLength = 80;
    public const int SpecialtyMaxLength = 60;
    public const int RegistrationCouncilMaxLength = 20;
    public const int RegistrationNumberMaxLength = 30;
    public const int RegistrationRegionMaxLength = 10;
    public const int ClinicNameMaxLength = 120;
    public const int AddressMaxLength = 400;
    public const int PhoneMaxLength = 30;
    public const int WhatsappMaxLength = 30;
    public const int EmailMaxLength = 120;
    public const int WebsiteMaxLength = 200;
    public const int NotesMaxLength = 1000;

    private CareProviderTerms()
    {
    }

    public string Name { get; private init; } = string.Empty;

    public string? Specialty { get; private init; }

    public string? RegistrationCouncil { get; private init; }

    public string? RegistrationNumber { get; private init; }

    public string? RegistrationRegion { get; private init; }

    public string? ClinicName { get; private init; }

    public string? Address { get; private init; }

    public string? Phone { get; private init; }

    public string? Whatsapp { get; private init; }

    public string? Email { get; private init; }

    public string? Website { get; private init; }

    public string? Notes { get; private init; }

    public bool IsFavorite { get; private init; }

    public bool IsDeleted { get; private init; }

    /// <summary>Validates every rule; throws <see cref="DomainValidationException"/> naming the field.</summary>
    public static CareProviderTerms Create(
        string? name,
        string? specialty,
        string? registrationCouncil,
        string? registrationNumber,
        string? registrationRegion,
        string? clinicName,
        string? address,
        string? phone,
        string? whatsapp,
        string? email,
        string? website,
        string? notes,
        bool isFavorite,
        bool isDeleted) =>
        new()
        {
            Name = Text.Required(name, "name", NameMaxLength),
            Specialty = Text.Optional(specialty, "specialty", SpecialtyMaxLength),
            RegistrationCouncil = Text.Optional(registrationCouncil, "registrationCouncil", RegistrationCouncilMaxLength),
            RegistrationNumber = Text.Optional(registrationNumber, "registrationNumber", RegistrationNumberMaxLength),
            RegistrationRegion = Text.Optional(registrationRegion, "registrationRegion", RegistrationRegionMaxLength),
            ClinicName = Text.Optional(clinicName, "clinicName", ClinicNameMaxLength),
            Address = Text.Optional(address, "address", AddressMaxLength),
            Phone = Text.Optional(phone, "phone", PhoneMaxLength),
            Whatsapp = Text.Optional(whatsapp, "whatsapp", WhatsappMaxLength),
            Email = Text.Optional(email, "email", EmailMaxLength),
            Website = EnsureWebsite(Text.Optional(website, "website", WebsiteMaxLength)),
            Notes = Text.Optional(notes, "notes", NotesMaxLength),
            IsFavorite = isFavorite,
            IsDeleted = isDeleted,
        };

    private static string? EnsureWebsite(string? website) =>
        website is null || !SchemeStart().IsMatch(website) || HttpScheme().IsMatch(website)
            ? website
            : throw new DomainValidationException("website", "website must be an http or https address.");

    [GeneratedRegex(@"^[A-Za-z][A-Za-z0-9+.\-]*:(?!\d)")]
    private static partial Regex SchemeStart();

    [GeneratedRegex(@"^https?://", RegexOptions.IgnoreCase)]
    private static partial Regex HttpScheme();
}
