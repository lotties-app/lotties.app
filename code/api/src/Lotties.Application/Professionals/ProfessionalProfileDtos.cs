using System.Text.Json.Serialization;
using Lotties.Application.Serialization;
using Lotties.Domain.Professionals;

namespace Lotties.Application.Professionals;

/// <summary>
/// Body of <c>PUT /api/v1/me/professional-profile</c>: the full editable state. <c>kind</c> defaults to <c>doctor</c>
/// (the only kind in v1); <c>displayName</c> is required. There is no <c>verified</c>: v1 profiles are self-declared.
/// </summary>
public sealed record SaveProfessionalProfileRequest
{
    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public ProfessionalKind? Kind { get; init; }

    public string? DisplayName { get; init; }

    public string? Specialty { get; init; }

    public string? RegistrationNumber { get; init; }

    /// <summary>Validates every rule; throws <see cref="Domain.Exceptions.DomainValidationException"/> naming the field.</summary>
    public static explicit operator ProfessionalProfileTerms(SaveProfessionalProfileRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return ProfessionalProfileTerms.Create(request.Kind ?? ProfessionalKind.Doctor, request.DisplayName, request.Specialty, request.RegistrationNumber);
    }
}

/// <summary>The caller's own professional profile.</summary>
public sealed record ProfessionalProfileResponse
{
    public Guid UserId { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public ProfessionalKind Kind { get; init; }

    public required string DisplayName { get; init; }

    public string? Specialty { get; init; }

    public string? RegistrationNumber { get; init; }

    /// <summary>Always <c>false</c> in v1: the profile is self-declared.</summary>
    public bool Verified { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset UpdatedAt { get; init; }

    public static implicit operator ProfessionalProfileResponse(ProfessionalProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);
        return new ProfessionalProfileResponse
        {
            UserId = profile.UserId,
            Kind = profile.Kind,
            DisplayName = profile.DisplayName,
            Specialty = profile.Specialty,
            RegistrationNumber = profile.RegistrationNumber,
            Verified = profile.Verified,
            CreatedAt = profile.CreatedAt,
            UpdatedAt = profile.UpdatedAt,
        };
    }
}

/// <summary>What the members of a baby see of a professional: her name, specialty, registration and whether it was verified.</summary>
public sealed record ProfessionalSummary
{
    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public ProfessionalKind Kind { get; init; }

    public required string DisplayName { get; init; }

    public string? Specialty { get; init; }

    public string? RegistrationNumber { get; init; }

    /// <summary>Always <c>false</c> in v1: clients show "Self-declared".</summary>
    public bool Verified { get; init; }

    public static implicit operator ProfessionalSummary(ProfessionalProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);
        return new ProfessionalSummary
        {
            Kind = profile.Kind,
            DisplayName = profile.DisplayName,
            Specialty = profile.Specialty,
            RegistrationNumber = profile.RegistrationNumber,
            Verified = profile.Verified,
        };
    }
}

/// <summary>
/// A person named on a baby's data (a note's author, who recorded a measurement, who accessed the baby): the name the
/// family sees (the professional name when she declared a profile, else the account's display name) and her
/// professional details, if any.
/// </summary>
public sealed record PersonSummary
{
    public Guid UserId { get; init; }

    public required string DisplayName { get; init; }

    public ProfessionalSummary? Professional { get; init; }
}

/// <summary>The outcome of a save: the profile as stored, and whether this request declared it.</summary>
public sealed record SaveProfessionalProfileResult(ProfessionalProfileResponse Profile, bool Created);
