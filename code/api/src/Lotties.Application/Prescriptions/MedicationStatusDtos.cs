using System.Text.Json.Serialization;
using Lotties.Application.Serialization;
using Lotties.Domain.Prescriptions;

namespace Lotties.Application.Prescriptions;

/// <summary>The per-kg suggestion with every input (see <see cref="SuggestedDose"/>); the parent always confirms it.</summary>
public sealed record SuggestedDoseDto
{
    public decimal Amount { get; init; }

    public decimal ExactAmount { get; init; }

    public string Unit { get; init; } = string.Empty;

    public decimal PerKgAmount { get; init; }

    public decimal KgUsed { get; init; }

    public DateOnly WeightDate { get; init; }

    /// <summary>The weight is more than 30 days older than the family's local today.</summary>
    public bool Stale { get; init; }

    public decimal? RoundingStep { get; init; }

    public static implicit operator SuggestedDoseDto(SuggestedDose dose)
    {
        ArgumentNullException.ThrowIfNull(dose);
        return new SuggestedDoseDto
        {
            Amount = dose.Amount,
            ExactAmount = dose.ExactAmount,
            Unit = dose.Unit,
            PerKgAmount = dose.PerKgAmount,
            KgUsed = dose.KgUsed,
            WeightDate = dose.WeightDate,
            Stale = dose.Stale,
            RoundingStep = dose.RoundingStep,
        };
    }
}

/// <summary>A substance of the linked catalog product.</summary>
public sealed record StatusSubstanceDto
{
    public Guid Id { get; init; }

    public string Key { get; init; } = string.Empty;

    public string NameEn { get; init; } = string.Empty;

    public string NamePtBr { get; init; } = string.Empty;
}

/// <summary>The catalog product the prescription's medication is linked to.</summary>
public sealed record StatusProductDto
{
    public Guid Id { get; init; }

    public string Name { get; init; } = string.Empty;

    public IReadOnlyList<StatusSubstanceDto> Substances { get; init; } = [];
}

/// <summary>Another active prescription sharing the interval group.</summary>
public sealed record GroupMemberDto
{
    public Guid PrescriptionId { get; init; }

    public Guid MedicationId { get; init; }

    public string MedicationName { get; init; } = string.Empty;
}

/// <summary>
/// The computed state of one active prescription plus the rule fields (no prose: the client words it). Times are UTC.
/// <c>availableAt</c> may be in the past; <c>overdueByMinutes</c> is whole minutes.
/// </summary>
public sealed record PrescriptionStatusResponse
{
    public Guid PrescriptionId { get; init; }

    public Guid MedicationId { get; init; }

    public string MedicationName { get; init; } = string.Empty;

    public StatusProductDto? Product { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public PrescriptionKind Kind { get; init; }

    public required DoseRuleDto Dose { get; init; }

    public IReadOnlyList<string>? TimesOfDay { get; init; }

    public int? EveryMinutes { get; init; }

    public int? MinIntervalMinutes { get; init; }

    public int? MaxDosesPer24h { get; init; }

    public string? Indication { get; init; }

    public string? IntervalGroup { get; init; }

    public IReadOnlyList<GroupMemberDto> GroupMembers { get; init; } = [];

    public DateOnly StartDate { get; init; }

    public DateOnly? EndDate { get; init; }

    public bool CourseStarted { get; init; }

    public bool CourseEnded { get; init; }

    public bool AvailableNow { get; init; }

    public DateTimeOffset? AvailableAt { get; init; }

    public DateTimeOffset? NextScheduledAt { get; init; }

    public int? OverdueByMinutes { get; init; }

    public DateTimeOffset? LastDoseAt { get; init; }

    public int DosesLast24h { get; init; }

    public bool LimitReached { get; init; }

    public SuggestedDoseDto? SuggestedDose { get; init; }
}

/// <summary>Response of <c>GET /api/v1/babies/{babyId}/medications/status</c>.</summary>
public sealed record MedicationStatusListResponse
{
    public Guid BabyId { get; init; }

    public DateTimeOffset GeneratedAt { get; init; }

    public int UtcOffsetMinutes { get; init; }

    public IReadOnlyList<PrescriptionStatusResponse> Items { get; init; } = [];
}
