using System.Text.Json.Serialization;
using Lotties.Application.Professionals;
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

/// <summary>The dose and schedule parts of a request, parsed with the domain rules (prescriptions and prescription proposals share them).</summary>
internal static class ScheduleRequestParts
{
    /// <summary>The required dose; throws <see cref="DomainValidationException"/> (fields <c>dose</c>, <c>dose.*</c>).</summary>
    public static DoseRule DoseOf(DoseRuleDto? dose) =>
        dose is null ? throw new DomainValidationException("dose", "dose is required.") : (DoseRule)dose;

    /// <summary>The schedule; throws <see cref="DomainValidationException"/> naming the field.</summary>
    public static PrescriptionSchedule ScheduleOf(
        PrescriptionKind? kind,
        IReadOnlyList<string>? timesOfDay,
        int? everyMinutes,
        int? minIntervalMinutes,
        int? maxDosesPer24h,
        string? indication,
        IReadOnlyList<string>? dayParts,
        IReadOnlyList<DayPartReminderDto>? dayPartReminders) =>
        PrescriptionSchedule.Create(
            kind ?? throw new DomainValidationException("kind", "kind is required."),
            timesOfDay is null ? null : TimesOfDay.Parse(timesOfDay),
            everyMinutes,
            minIntervalMinutes,
            maxDosesPer24h,
            indication,
            dayParts is null ? null : DayPartSet.Parse(dayParts),
            DayPartReminderDto.ToReminders(dayPartReminders));
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
        var dose = ScheduleRequestParts.DoseOf(request.Dose);
        var schedule = ScheduleRequestParts.ScheduleOf(
            request.Kind,
            request.TimesOfDay,
            request.EveryMinutes,
            request.MinIntervalMinutes,
            request.MaxDosesPer24h,
            request.Indication,
            request.DayParts,
            request.DayPartReminders);
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

/// <summary>
/// What a doctor's proposal said, as the parents accepted it (<c>original</c> of a doctor-sourced prescription): the
/// medication name, the dose and the schedule in the same shape as on a prescription.
/// </summary>
public sealed record PrescriptionSnapshotDto
{
    public required string MedicationName { get; init; }

    public Guid? ProductId { get; init; }

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

    public static implicit operator PrescriptionSnapshotDto(PrescriptionSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        return new PrescriptionSnapshotDto
        {
            MedicationName = snapshot.MedicationName,
            ProductId = snapshot.ProductId,
            Kind = snapshot.Kind,
            Dose = new DoseRuleDto { Amount = snapshot.DoseAmount, Unit = snapshot.DoseUnit, PerKg = snapshot.DosePerKg, RoundingStep = snapshot.DoseRoundingStep },
            TimesOfDay = snapshot.TimesOfDay,
            EveryMinutes = snapshot.EveryMinutes,
            DayParts = snapshot.DayParts,
            DayPartReminders = snapshot.DayPartReminders?.Select(reminder => new DayPartReminderDto { Part = reminder.Part, Time = reminder.Time }).ToArray(),
            MinIntervalMinutes = snapshot.MinIntervalMinutes,
            MaxDosesPer24h = snapshot.MaxDosesPer24h,
            Indication = snapshot.Indication,
            IntervalGroup = snapshot.IntervalGroup,
            StartDate = snapshot.StartDate,
            EndDate = snapshot.EndDate,
            Instructions = snapshot.Instructions,
        };
    }
}

/// <summary>
/// A prescription as stored (soft-deleted ones carry <see cref="DeletedAt"/>); fields mirror the request. A prescription
/// accepted from a doctor's proposal adds its provenance (docs/design/16-doctor-access.md section 10.2).
/// </summary>
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

    /// <summary>The doctor whose accepted proposal created it; <c>null</c> when a parent entered it.</summary>
    public Guid? PrescribedByUserId { get; init; }

    /// <summary>The doctor's display name when the parents accepted (a snapshot, without a title).</summary>
    public string? PrescribedByName { get; init; }

    /// <summary>The doctor as the family sees her now (verified or self-declared); <c>null</c> for a parent-entered one or a removed account.</summary>
    public PersonSummary? PrescribedBy { get; init; }

    /// <summary>The accepted proposal it came from.</summary>
    public Guid? ProposalId { get; init; }

    /// <summary>A parent changed its content after accepting (doctor-sourced prescriptions only; never reset).</summary>
    public bool ChangedByParent { get; init; }

    /// <summary>What the doctor's proposal said (doctor-sourced prescriptions only).</summary>
    public PrescriptionSnapshotDto? Original { get; init; }

    /// <summary>The response with the prescribing doctor resolved from <paramref name="people"/> (when doctor-sourced).</summary>
    public static PrescriptionResponse For(Prescription prescription, IReadOnlyDictionary<Guid, PersonSummary> people)
    {
        ArgumentNullException.ThrowIfNull(prescription);
        ArgumentNullException.ThrowIfNull(people);
        PrescriptionResponse response = prescription;
        return prescription.PrescribedByUserId is { } doctorId ? response with { PrescribedBy = people.GetValueOrDefault(doctorId) } : response;
    }

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
            PrescribedByUserId = prescription.PrescribedByUserId,
            PrescribedByName = prescription.PrescribedByName,
            ProposalId = prescription.ProposalId,
            ChangedByParent = prescription.ChangedByParent,
            Original = prescription.OriginalSnapshot is { } original ? (PrescriptionSnapshotDto)original : null,
        };
    }
}

/// <summary>The outcome of an upsert: the prescription as stored, and whether this request created it.</summary>
public sealed record UpsertPrescriptionResult(PrescriptionResponse Prescription, bool Created);
