using System.Text.Json.Serialization;
using Lotties.Application.Serialization;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Prescriptions;

namespace Lotties.Application.Prescriptions;

/// <summary>The prescribed dose: <c>amount</c> <c>unit</c> per dose, or per kg when <c>perKg</c> (then optional <c>roundingStep</c>).</summary>
public sealed record DoseRuleDto
{
    public required decimal Amount { get; init; }

    public required string Unit { get; init; }

    public bool PerKg { get; init; }

    public decimal? RoundingStep { get; init; }

    public static implicit operator DoseRuleDto(DoseRule dose)
    {
        ArgumentNullException.ThrowIfNull(dose);
        return new DoseRuleDto { Amount = dose.Amount, Unit = dose.Unit, PerKg = dose.PerKg, RoundingStep = dose.RoundingStep };
    }

    /// <summary>Validates with the domain rules; throws <see cref="DomainValidationException"/> (fields <c>dose.*</c>).</summary>
    public static explicit operator DoseRule(DoseRuleDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);
        return DoseRule.Create(dto.Amount, dto.Unit, dto.PerKg, dto.RoundingStep);
    }
}

/// <summary>The reminder time of one part of the day: <c>{"part":"morning","time":"08:00"}</c>.</summary>
public sealed record DayPartReminderDto
{
    public string? Part { get; init; }

    public string? Time { get; init; }

    public static implicit operator DayPartReminderDto(DayPartReminder reminder)
    {
        ArgumentNullException.ThrowIfNull(reminder);
        return new DayPartReminderDto { Part = DayPartWindows.CodeOf(reminder.Part), Time = reminder.TimeText };
    }

    /// <summary>Validates with the domain rules; throws <see cref="DomainValidationException"/> (field <c>dayPartReminders</c>).</summary>
    public static explicit operator DayPartReminder(DayPartReminderDto dto) =>
        dto is null
            ? throw new DomainValidationException(Domain.Prescriptions.DayPartReminders.Field, "dayPartReminders entries must not be null.")
            : DayPartReminder.Parse(dto.Part, dto.Time);

    /// <summary>The reminders of a request; <c>null</c> or an empty list means reminders are off.</summary>
    public static DayPartReminders? ToReminders(IReadOnlyList<DayPartReminderDto>? reminders) =>
        reminders is { Count: > 0 } list ? Domain.Prescriptions.DayPartReminders.Create(list.Select(reminder => (DayPartReminder)reminder).ToArray()) : null;

    public static IReadOnlyList<DayPartReminderDto>? FromReminders(DayPartReminders? reminders) =>
        reminders?.Values.Select(reminder => (DayPartReminderDto)reminder).ToArray();
}

/// <summary>
/// Body of <c>PUT /api/v1/babies/{babyId}/prescriptions/{prescriptionId}</c>: the full editable state. <c>status</c>
/// defaults to <c>active</c>; <c>kind</c>, <c>dose</c> and <c>startDate</c> are required. Scheduled: exactly one of
/// <c>timesOfDay</c> (<c>["08:00","20:00"]</c>), <c>everyMinutes</c> or <c>dayParts</c> (<c>["morning","night"]</c>,
/// with optional <c>dayPartReminders</c> for chosen parts). As needed: <c>minIntervalMinutes</c>, optional
/// <c>maxDosesPer24h</c>. <c>updatedAt</c> is the client edit time (last write wins, as for events).
/// </summary>
public sealed record UpsertPrescriptionRequest
{
    public Guid MedicationId { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public PrescriptionStatus? Status { get; init; }

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

    public string? Prescriber { get; init; }

    public string? Instructions { get; init; }

    public DateTimeOffset? UpdatedAt { get; init; }

    /// <summary>Validates every rule; throws <see cref="DomainValidationException"/> naming the field.</summary>
    public static explicit operator PrescriptionTerms(UpsertPrescriptionRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var dose = request.Dose is null ? throw new DomainValidationException("dose", "dose is required.") : (DoseRule)request.Dose;
        var schedule = PrescriptionSchedule.Create(
            request.Kind ?? throw new DomainValidationException("kind", "kind is required."),
            request.TimesOfDay is null ? null : Domain.Prescriptions.TimesOfDay.Parse(request.TimesOfDay),
            request.EveryMinutes,
            request.MinIntervalMinutes,
            request.MaxDosesPer24h,
            request.Indication,
            request.DayParts is null ? null : DayPartSet.Parse(request.DayParts),
            DayPartReminderDto.ToReminders(request.DayPartReminders));
        return PrescriptionTerms.Create(
            request.MedicationId,
            request.Status ?? PrescriptionStatus.Active,
            dose,
            schedule,
            Domain.Prescriptions.IntervalGroup.FromOptional(request.IntervalGroup),
            request.StartDate ?? throw new DomainValidationException("startDate", "startDate is required."),
            request.EndDate,
            request.Prescriber,
            request.Instructions);
    }
}

/// <summary>A prescription as stored (soft-deleted ones carry <see cref="DeletedAt"/>); fields mirror the request.</summary>
public sealed record PrescriptionResponse
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public Guid MedicationId { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public PrescriptionStatus Status { get; init; }

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

    public string? Prescriber { get; init; }

    public string? Instructions { get; init; }

    public Guid CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary>Server receive time of the last change; the delta cursor.</summary>
    public DateTimeOffset UpdatedAt { get; init; }

    /// <summary>Client edit time of the last applied change; decides conflicts.</summary>
    public DateTimeOffset ClientUpdatedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }

    public static implicit operator PrescriptionResponse(Prescription prescription)
    {
        ArgumentNullException.ThrowIfNull(prescription);
        return new PrescriptionResponse
        {
            Id = prescription.Id,
            BabyId = prescription.BabyId,
            MedicationId = prescription.MedicationId,
            Status = prescription.Status,
            Kind = prescription.Schedule.Kind,
            Dose = prescription.Dose,
            TimesOfDay = prescription.Schedule.TimesOfDay?.ToStrings(),
            EveryMinutes = prescription.Schedule.EveryMinutes,
            DayParts = prescription.Schedule.DayParts?.ToCodes(),
            DayPartReminders = DayPartReminderDto.FromReminders(prescription.Schedule.DayPartReminders),
            MinIntervalMinutes = prescription.Schedule.MinIntervalMinutes,
            MaxDosesPer24h = prescription.Schedule.MaxDosesPer24h,
            Indication = prescription.Schedule.Indication,
            IntervalGroup = prescription.IntervalGroup?.Value,
            StartDate = prescription.StartDate,
            EndDate = prescription.EndDate,
            Prescriber = prescription.Prescriber,
            Instructions = prescription.Instructions,
            CreatedBy = prescription.CreatedBy,
            CreatedAt = prescription.CreatedAt,
            UpdatedAt = prescription.UpdatedAt,
            ClientUpdatedAt = prescription.ClientUpdatedAt,
            DeletedAt = prescription.DeletedAt,
        };
    }
}

/// <summary>The outcome of an upsert: the prescription as stored, and whether this request created it.</summary>
public sealed record UpsertPrescriptionResult(PrescriptionResponse Prescription, bool Created);
