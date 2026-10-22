namespace Lotties.Domain.Prescriptions;

/// <summary>
/// What a doctor prescribed, as she sent it in her proposal (docs/design/16-doctor-access.md section 10.2): kept on the
/// prescription the parents accepted (<see cref="Prescription.OriginalSnapshot"/>) so "See what the doctor prescribed"
/// can show it after a parent changed the prescription. Plain values only, stored as JSON and never validated again:
/// it is a record of what was sent, not terms that apply.
/// </summary>
public sealed record PrescriptionSnapshot
{
    public required string MedicationName { get; init; }

    public Guid? ProductId { get; init; }

    public PrescriptionKind Kind { get; init; }

    public decimal DoseAmount { get; init; }

    public required string DoseUnit { get; init; }

    public bool DosePerKg { get; init; }

    public decimal? DoseRoundingStep { get; init; }

    public IReadOnlyList<string>? TimesOfDay { get; init; }

    public int? EveryMinutes { get; init; }

    public IReadOnlyList<string>? DayParts { get; init; }

    public IReadOnlyList<PrescriptionSnapshotReminder>? DayPartReminders { get; init; }

    public int? MinIntervalMinutes { get; init; }

    public int? MaxDosesPer24h { get; init; }

    public string? Indication { get; init; }

    public string? IntervalGroup { get; init; }

    public DateOnly StartDate { get; init; }

    public DateOnly? EndDate { get; init; }

    public string? Instructions { get; init; }

    /// <summary>The snapshot of a medication name, an optional product and the prescription components.</summary>
    public static PrescriptionSnapshot Of(
        string medicationName,
        Guid? productId,
        DoseRule dose,
        PrescriptionSchedule schedule,
        IntervalGroup? intervalGroup,
        DateOnly startDate,
        DateOnly? endDate,
        string? instructions)
    {
        ArgumentNullException.ThrowIfNull(medicationName);
        ArgumentNullException.ThrowIfNull(dose);
        ArgumentNullException.ThrowIfNull(schedule);
        return new PrescriptionSnapshot
        {
            MedicationName = medicationName,
            ProductId = productId,
            Kind = schedule.Kind,
            DoseAmount = dose.Amount,
            DoseUnit = dose.Unit,
            DosePerKg = dose.PerKg,
            DoseRoundingStep = dose.RoundingStep,
            TimesOfDay = schedule.TimesOfDay?.ToStrings(),
            EveryMinutes = schedule.EveryMinutes,
            DayParts = schedule.DayParts?.ToCodes(),
            DayPartReminders = schedule.DayPartReminders?.Values.Select(PrescriptionSnapshotReminder.Of).ToArray(),
            MinIntervalMinutes = schedule.MinIntervalMinutes,
            MaxDosesPer24h = schedule.MaxDosesPer24h,
            Indication = schedule.Indication,
            IntervalGroup = intervalGroup?.Value,
            StartDate = startDate,
            EndDate = endDate,
            Instructions = instructions,
        };
    }
}

/// <summary>A part-of-the-day reminder in a <see cref="PrescriptionSnapshot"/>: part code and <c>HH:mm</c>.</summary>
public sealed record PrescriptionSnapshotReminder(string Part, string Time)
{
    public static PrescriptionSnapshotReminder Of(DayPartReminder reminder)
    {
        ArgumentNullException.ThrowIfNull(reminder);
        return new PrescriptionSnapshotReminder(DayPartWindows.CodeOf(reminder.Part), reminder.TimeText);
    }
}

/// <summary>Who prescribed an accepted prescription: the doctor, her name at accept time, her proposal and what it said.</summary>
public sealed record PrescriptionProvenance(Guid PrescribedByUserId, string PrescribedByName, Guid ProposalId, PrescriptionSnapshot Original);
