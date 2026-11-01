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

/// <summary>One chosen part of the day on one routine day (see <see cref="DayPartSlot"/>); instants in UTC.</summary>
public sealed record DayPartSlotDto
{
    public string Part { get; init; } = string.Empty;

    public DateOnly Day { get; init; }

    public DateTimeOffset Start { get; init; }

    public DateTimeOffset End { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public DayPartState State { get; init; }

    public DateTimeOffset? GivenAt { get; init; }

    public int DoseCount { get; init; }

    public DateTimeOffset? ReminderAt { get; init; }

    public static implicit operator DayPartSlotDto(DayPartSlot slot)
    {
        ArgumentNullException.ThrowIfNull(slot);
        return new DayPartSlotDto
        {
            Part = DayPartWindows.CodeOf(slot.Part),
            Day = slot.Window.Day,
            Start = slot.Window.Start,
            End = slot.Window.End,
            State = slot.State,
            GivenAt = slot.GivenAt,
            DoseCount = slot.DoseCount,
            ReminderAt = slot.ReminderAt,
        };
    }
}

/// <summary>
/// The part-of-the-day state of a prescription (see <see cref="DayPartsStatus"/>): today's chosen parts, the current
/// and next ones, <c>givenCount</c> of <c>total</c> ("1 of 2 today") and the guard a client asks before logging now.
/// </summary>
public sealed record DayPartsStatusDto
{
    public DateOnly Day { get; init; }

    public IReadOnlyList<DayPartSlotDto> Parts { get; init; } = [];

    public string? CurrentPart { get; init; }

    public DayPartSlotDto? Next { get; init; }

    public int GivenCount { get; init; }

    public int Total { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public DayPartGuard Guard { get; init; }

    public static implicit operator DayPartsStatusDto(DayPartsStatus status)
    {
        ArgumentNullException.ThrowIfNull(status);
        return new DayPartsStatusDto
        {
            Day = status.Day,
            Parts = status.Parts.Select(slot => (DayPartSlotDto)slot).ToArray(),
            CurrentPart = status.Current is { } current ? DayPartWindows.CodeOf(current.Part) : null,
            Next = status.Next is null ? null : (DayPartSlotDto)status.Next,
            GivenCount = status.GivenCount,
            Total = status.Parts.Count,
            Guard = status.Guard,
        };
    }
}

/// <summary>
/// The computed state of one active prescription plus the rule fields (no prose: the client words it). Times are UTC.
/// <c>availableAt</c> may be in the past; <c>overdueByMinutes</c> is whole minutes. <c>dayPartsStatus</c> only for
/// part-of-the-day prescriptions.
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

    public IReadOnlyList<string>? DayParts { get; init; }

    public IReadOnlyList<DayPartReminderDto>? DayPartReminders { get; init; }

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

    public DayPartsStatusDto? DayPartsStatus { get; init; }
}

/// <summary>Response of <c>GET /api/v1/babies/{babyId}/medications/status</c>.</summary>
public sealed record MedicationStatusListResponse
{
    public Guid BabyId { get; init; }

    public DateTimeOffset GeneratedAt { get; init; }

    public int UtcOffsetMinutes { get; init; }

    public IReadOnlyList<PrescriptionStatusResponse> Items { get; init; } = [];
}
