using Lotties.Domain.CareProviders;

namespace Lotties.Application.CareProviders;

/// <summary>
/// Body of <c>PUT /api/v1/babies/{babyId}/care-providers/{providerId}</c>: the full editable state. Only <c>name</c> is
/// required; <c>isFavorite</c> and <c>isDeleted</c> default to <c>false</c>. <c>updatedAt</c> is the client edit time
/// (last write wins, as for events).
/// </summary>
public sealed record UpsertCareProviderRequest
{
    public string? Name { get; init; }

    public string? Specialty { get; init; }

    public string? RegistrationCouncil { get; init; }

    public string? RegistrationNumber { get; init; }

    public string? RegistrationRegion { get; init; }

    public string? ClinicName { get; init; }

    public string? Address { get; init; }

    public string? Phone { get; init; }

    public string? Whatsapp { get; init; }

    public string? Email { get; init; }

    public string? Website { get; init; }

    public string? Notes { get; init; }

    public bool? IsFavorite { get; init; }

    public bool? IsDeleted { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }

    /// <summary>Validates every rule; throws <see cref="Lotties.Domain.Exceptions.DomainValidationException"/> naming the field.</summary>
    public static explicit operator CareProviderTerms(UpsertCareProviderRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return CareProviderTerms.Create(
            request.Name,
            request.Specialty,
            request.RegistrationCouncil,
            request.RegistrationNumber,
            request.RegistrationRegion,
            request.ClinicName,
            request.Address,
            request.Phone,
            request.Whatsapp,
            request.Email,
            request.Website,
            request.Notes,
            request.IsFavorite ?? false,
            request.IsDeleted ?? false);
    }
}

/// <summary>A care provider as stored.</summary>
public sealed record CareProviderResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public required string Name { get; init; }

    public string? Specialty { get; init; }

    public string? RegistrationCouncil { get; init; }

    public string? RegistrationNumber { get; init; }

    public string? RegistrationRegion { get; init; }

    public string? ClinicName { get; init; }

    public string? Address { get; init; }

    public string? Phone { get; init; }

    public string? Whatsapp { get; init; }

    public string? Email { get; init; }

    public string? Website { get; init; }

    public string? Notes { get; init; }

    public bool IsFavorite { get; init; }

    public bool IsDeleted { get; init; }

    public Guid CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>Server receive time of the last change; the delta cursor.</summary>
    public DateTimeOffset UpdatedAt { get; init; }

    /// <summary>Client edit time of the last applied change; decides conflicts.</summary>
    public DateTimeOffset ClientUpdatedAt { get; init; }

    public static implicit operator CareProviderResponse(CareProvider provider)
    {
        ArgumentNullException.ThrowIfNull(provider);
        return new CareProviderResponse
        {
            Id = provider.Id,
            BabyId = provider.BabyId,
            Name = provider.Name,
            Specialty = provider.Specialty,
            RegistrationCouncil = provider.RegistrationCouncil,
            RegistrationNumber = provider.RegistrationNumber,
            RegistrationRegion = provider.RegistrationRegion,
            ClinicName = provider.ClinicName,
            Address = provider.Address,
            Phone = provider.Phone,
            Whatsapp = provider.Whatsapp,
            Email = provider.Email,
            Website = provider.Website,
            Notes = provider.Notes,
            IsFavorite = provider.IsFavorite,
            IsDeleted = provider.IsDeleted,
            CreatedBy = provider.CreatedBy,
            CreatedAt = provider.CreatedAt,
            UpdatedAt = provider.UpdatedAt,
            ClientUpdatedAt = provider.ClientUpdatedAt,
        };
    }
}

/// <summary>The outcome of an upsert: the provider as stored, and whether this request created it.</summary>
public sealed record UpsertCareProviderResult(CareProviderResponse Provider, bool Created);
