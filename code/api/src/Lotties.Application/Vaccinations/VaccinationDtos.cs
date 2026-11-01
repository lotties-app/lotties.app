using System.Text.Json.Serialization;
using Lotties.Application.Serialization;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Vaccinations;

namespace Lotties.Application.Vaccinations;

/// <summary>
/// Body of <c>PUT /api/v1/babies/{babyId}/vaccinations/{vaccinationId}</c>: the full editable state. <c>givenOn</c> and
/// <c>network</c> are required; <c>customName</c> is required exactly when <c>vaccineKey</c> is absent; <c>doseLabel</c> is
/// the label as shown when recorded. <c>updatedAt</c> is the client edit time (last write wins, as for events).
/// </summary>
public sealed record UpsertVaccinationRequest
{
    public string? VaccineKey { get; init; }

    public string? DoseId { get; init; }

    public string? CustomName { get; init; }

    public string? DoseLabel { get; init; }

    public DateOnly? GivenOn { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public VaccineNetwork? Network { get; init; }

    public string? Clinic { get; init; }

    public string? Lot { get; init; }

    public string? AdministeredBy { get; init; }

    public string? Notes { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }

    /// <summary>Validates every rule but the clock one; throws <see cref="DomainValidationException"/> naming the field.</summary>
    public static explicit operator VaccinationTerms(UpsertVaccinationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return VaccinationTerms.Create(
            request.VaccineKey,
            request.DoseId,
            request.CustomName,
            request.DoseLabel,
            request.GivenOn ?? throw new DomainValidationException("givenOn", "givenOn is required."),
            request.Network ?? throw new DomainValidationException("network", "network is required."),
            request.Clinic,
            request.Lot,
            request.AdministeredBy,
            request.Notes);
    }
}

/// <summary>A recorded vaccine as stored (a deleted one keeps its data and has <see cref="DeletedAt"/>).</summary>
public sealed record VaccinationResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public string? VaccineKey { get; init; }

    public string? DoseId { get; init; }

    public string? CustomName { get; init; }

    public string? DoseLabel { get; init; }

    public DateOnly GivenOn { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public VaccineNetwork Network { get; init; }

    public string? Clinic { get; init; }

    public string? Lot { get; init; }

    public string? AdministeredBy { get; init; }

    public string? Notes { get; init; }

    public Guid CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>Server receive time of the last change; the delta cursor.</summary>
    public DateTimeOffset UpdatedAt { get; init; }

    /// <summary>Client edit time of the last applied change; decides conflicts.</summary>
    public DateTimeOffset ClientUpdatedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }

    public static implicit operator VaccinationResponse(Vaccination vaccination)
    {
        ArgumentNullException.ThrowIfNull(vaccination);
        return new VaccinationResponse
        {
            Id = vaccination.Id,
            BabyId = vaccination.BabyId,
            VaccineKey = vaccination.VaccineKey,
            DoseId = vaccination.DoseId,
            CustomName = vaccination.CustomName,
            DoseLabel = vaccination.DoseLabel,
            GivenOn = vaccination.GivenOn,
            Network = vaccination.Network,
            Clinic = vaccination.Clinic,
            Lot = vaccination.Lot,
            AdministeredBy = vaccination.AdministeredBy,
            Notes = vaccination.Notes,
            CreatedBy = vaccination.CreatedBy,
            CreatedAt = vaccination.CreatedAt,
            UpdatedAt = vaccination.UpdatedAt,
            ClientUpdatedAt = vaccination.ClientUpdatedAt,
            DeletedAt = vaccination.DeletedAt,
        };
    }
}

/// <summary>The outcome of an upsert: the record as stored, and whether this request created it.</summary>
public sealed record UpsertVaccinationResult(VaccinationResponse Vaccination, bool Created);
