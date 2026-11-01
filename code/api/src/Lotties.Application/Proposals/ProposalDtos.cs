using System.Text.Json.Serialization;
using Lotties.Application.Prescriptions;
using Lotties.Application.Professionals;
using Lotties.Application.Serialization;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;

namespace Lotties.Application.Proposals;

/// <summary>
/// Body of <c>PUT /api/v1/babies/{babyId}/prescription-proposals/{proposalId}</c> (the Doctor): the full editable state.
/// The medication: <c>medicationName</c> (required) and optionally <c>medicationId</c> (a medication of the baby's list)
/// or <c>productId</c> (a shared catalog product). The prescription fields are those of
/// <c>PUT /prescriptions/{id}</c> without <c>status</c> and <c>prescriber</c>, with the same rules;
/// <c>replacesPrescriptionId</c> names the prescription it changes. <c>updatedAt</c> is the doctor's edit time.
/// </summary>
public sealed record UpsertProposalRequest
{
    public Guid? MedicationId { get; init; }

    public Guid? ProductId { get; init; }

    public string? MedicationName { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public PrescriptionKind? Kind { get; init; }

    public DoseRuleDto? Dose { get; init; }

    public IReadOnlyList<string>? TimesOfDay { get; init; }

    public int? EveryMinutes { get; init; }

    public IReadOnlyList<string>? DayParts { get; init; }

    public IReadOnlyList<DayPartReminderDto>? DayPartReminders { get; init; }

    public int? MinIntervalMinutes { get; init; }

    public int? MaxDosesPer24h { get; init; }

    public string? Indication { get; init; }

    public string? IntervalGroup { get; init; }

    public DateOnly? StartDate { get; init; }

    public DateOnly? EndDate { get; init; }

    public string? Instructions { get; init; }

    public Guid? ReplacesPrescriptionId { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }

    /// <summary>Validates every rule (the prescription rules); throws <see cref="Domain.Exceptions.DomainValidationException"/> naming the field.</summary>
    public static explicit operator ProposalTerms(UpsertProposalRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return ProposalTerms.Create(
            MedicationReference.Create(request.MedicationId, request.ProductId, request.MedicationName),
            ScheduleRequestParts.DoseOf(request.Dose),
            ScheduleRequestParts.ScheduleOf(
                request.Kind,
                request.TimesOfDay,
                request.EveryMinutes,
                request.MinIntervalMinutes,
                request.MaxDosesPer24h,
                request.Indication,
                request.DayParts,
                request.DayPartReminders),
            Domain.Prescriptions.IntervalGroup.FromOptional(request.IntervalGroup),
            request.StartDate ?? throw new Domain.Exceptions.DomainValidationException("startDate", "startDate is required."),
            request.EndDate,
            request.Instructions,
            request.ReplacesPrescriptionId);
    }
}

/// <summary>
/// Body of <c>POST .../prescription-proposals/{proposalId}/accept</c> (Owner, Parent): the client-generated id of the new
/// prescription (a queued offline accept replays with the same id) and the accept day in the client's time zone (the
/// last day of the prescription it replaces; the UTC date when absent).
/// </summary>
public sealed record AcceptProposalRequest
{
    public Guid PrescriptionId { get; init; }

    public DateOnly? AcceptedOn { get; init; }
}

/// <summary>Body of <c>POST .../prescription-proposals/{proposalId}/decline</c> (Owner, Parent): an optional reason (at most 500) the doctor reads.</summary>
public sealed record DeclineProposalRequest
{
    public string? Reason { get; init; }
}

/// <summary>A prescription proposal as its reader sees it, with its author as the family sees her.</summary>
public sealed record ProposalResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public Guid AuthorUserId { get; init; }

    /// <summary>The doctor as the family sees her at the time of the read (<c>null</c> if the account is gone).</summary>
    public PersonSummary? Author { get; init; }

    public Guid? MedicationId { get; init; }

    public Guid? ProductId { get; init; }

    public required string MedicationName { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public PrescriptionKind Kind { get; init; }

    public required DoseRuleDto Dose { get; init; }

    public IReadOnlyList<string>? TimesOfDay { get; init; }

    public int? EveryMinutes { get; init; }

    public IReadOnlyList<string>? DayParts { get; init; }

    public IReadOnlyList<DayPartReminderDto>? DayPartReminders { get; init; }

    public int? MinIntervalMinutes { get; init; }

    public int? MaxDosesPer24h { get; init; }

    public string? Indication { get; init; }

    public string? IntervalGroup { get; init; }

    public DateOnly StartDate { get; init; }

    public DateOnly? EndDate { get; init; }

    public string? Instructions { get; init; }

    public Guid? ReplacesPrescriptionId { get; init; }

    /// <summary><c>pending</c>, <c>accepted</c>, <c>declined</c>, <c>cancelled</c> or <c>superseded</c>.</summary>
    public required string Status { get; init; }

    public string? DeclineReason { get; init; }

    /// <summary><c>withdrawn</c> or <c>access_removed</c> for a cancelled proposal.</summary>
    public string? CancelReason { get; init; }

    public Guid? DecidedBy { get; init; }

    public DateTimeOffset? DecidedAt { get; init; }

    public Guid? AcceptedPrescriptionId { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>Server receive time of the last change; the delta cursor.</summary>
    public DateTimeOffset UpdatedAt { get; init; }

    /// <summary>The doctor's edit time of the last applied change (a decision stamps the server time); decides conflicts.</summary>
    public DateTimeOffset ClientUpdatedAt { get; init; }

    public static ProposalResponse For(PrescriptionProposal proposal, PersonSummary? author)
    {
        ArgumentNullException.ThrowIfNull(proposal);
        return new ProposalResponse
        {
            Id = proposal.Id,
            BabyId = proposal.BabyId,
            AuthorUserId = proposal.AuthorUserId,
            Author = author,
            MedicationId = proposal.MedicationId,
            ProductId = proposal.ProductId,
            MedicationName = proposal.MedicationName,
            Kind = proposal.Schedule.Kind,
            Dose = proposal.Dose,
            TimesOfDay = proposal.Schedule.TimesOfDay?.ToStrings(),
            EveryMinutes = proposal.Schedule.EveryMinutes,
            DayParts = proposal.Schedule.DayParts?.ToCodes(),
            DayPartReminders = DayPartReminderDto.FromReminders(proposal.Schedule.DayPartReminders),
            MinIntervalMinutes = proposal.Schedule.MinIntervalMinutes,
            MaxDosesPer24h = proposal.Schedule.MaxDosesPer24h,
            Indication = proposal.Schedule.Indication,
            IntervalGroup = proposal.IntervalGroup?.Value,
            StartDate = proposal.StartDate,
            EndDate = proposal.EndDate,
            Instructions = proposal.Instructions,
            ReplacesPrescriptionId = proposal.ReplacesPrescriptionId,
            Status = proposal.StatusCode,
            DeclineReason = proposal.DeclineReason,
            CancelReason = proposal.CancelReason is { } reason ? ProposalCodes.Of(reason) : null,
            DecidedBy = proposal.DecidedBy,
            DecidedAt = proposal.DecidedAt,
            AcceptedPrescriptionId = proposal.AcceptedPrescriptionId,
            CreatedAt = proposal.CreatedAt,
            UpdatedAt = proposal.UpdatedAt,
            ClientUpdatedAt = proposal.ClientUpdatedAt,
        };
    }
}

/// <summary>The outcome of an upsert: the proposal as stored, and whether this request created it.</summary>
public sealed record UpsertProposalResult(ProposalResponse Proposal, bool Created);

/// <summary>The outcome of an accept or a decline: the proposal, and the prescription an accept created (<c>null</c> otherwise).</summary>
public sealed record ProposalDecisionResponse(ProposalResponse Proposal, PrescriptionResponse? Prescription);
