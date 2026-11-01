using Lotties.Application.Events;
using Lotties.Application.Formulas;
using Lotties.Application.Measurements;
using Lotties.Application.Prescriptions;
using Lotties.Domain.Clinical;
using Lotties.Domain.Vaccinations;

namespace Lotties.Application.Clinical;

/// <summary>
/// The doctor's clinical summary of a baby for a range of local days
/// (<c>GET /api/v1/babies/{babyId}/clinical-summary</c>). A section is <c>null</c> when the caller lacks its scope
/// (<c>daily_log</c> opens sleep, feeding, diapers and symptoms); with the scope but no data it is present with empty or zero values.
/// The numbers equal the parents' Insights: minutes are whole, averages per day have one decimal.
/// </summary>
public sealed record ClinicalSummaryResponse
{
    public Guid BabyId { get; init; }

    public DateOnly From { get; init; }

    public DateOnly To { get; init; }

    /// <summary>The local date of now.</summary>
    public DateOnly Today { get; init; }

    /// <summary>The IANA time zone the days were cut in, or <c>null</c> when only a UTC offset was known.</summary>
    public string? TimeZone { get; init; }

    public DateTimeOffset GeneratedAt { get; init; }

    /// <summary>The caller's effective scope codes (a non-Doctor member sees all six).</summary>
    public IReadOnlyList<string> Scopes { get; init; } = [];

    public SleepSectionResponse? Sleep { get; init; }

    public FeedingSectionResponse? Feeding { get; init; }

    public DiaperSectionResponse? Diapers { get; init; }

    public SymptomsSectionResponse? Symptoms { get; init; }

    public MedicationsSectionResponse? Medications { get; init; }

    public VaccinesSectionResponse? Vaccines { get; init; }

    public GrowthSectionResponse? Growth { get; init; }

    public FormulasSectionResponse? Formulas { get; init; }
}

/// <summary>Sleep of one local day: minutes inside the day, the naps and the longest session that started that day.</summary>
public sealed record SleepDayResponse
{
    public DateOnly Date { get; init; }

    public int TotalMinutes { get; init; }

    public int NightMinutes { get; init; }

    public int NapMinutes { get; init; }

    public int Naps { get; init; }

    public int LongestMinutes { get; init; }

    public static implicit operator SleepDayResponse(SleepDaySummary day)
    {
        ArgumentNullException.ThrowIfNull(day);
        return new SleepDayResponse
        {
            Date = day.Date,
            TotalMinutes = ClinicalRounding.Minutes(day.TotalMs),
            NightMinutes = ClinicalRounding.Minutes(day.NightMs),
            NapMinutes = ClinicalRounding.Minutes(day.NapMs),
            Naps = day.Naps,
            LongestMinutes = ClinicalRounding.Minutes(day.LongestMs),
        };
    }
}

/// <summary>The sleep section: per-day rows and the averages over the completed days with sleep (<see cref="DaysCounted"/>).</summary>
public sealed record SleepSectionResponse
{
    public IReadOnlyList<SleepDayResponse> Days { get; init; } = [];

    public int? AverageTotalMinutes { get; init; }

    public int? AverageNightMinutes { get; init; }

    public int? AverageNapMinutes { get; init; }

    public double? NapsPerDay { get; init; }

    public int DaysCounted { get; init; }

    public int? LongestStretchMinutes { get; init; }

    public DateTimeOffset? LongestStretchStartedAt { get; init; }

    /// <summary>The usual bedtime, <c>HH:mm</c> local, or <c>null</c> without data.</summary>
    public string? BedtimeMedian { get; init; }

    /// <summary>The usual wake-up, <c>HH:mm</c> local, or <c>null</c> without data.</summary>
    public string? WakeMedian { get; init; }

    public static implicit operator SleepSectionResponse(SleepSummary summary)
    {
        ArgumentNullException.ThrowIfNull(summary);
        return new SleepSectionResponse
        {
            Days = summary.Days.Select(day => (SleepDayResponse)day).ToArray(),
            AverageTotalMinutes = ClinicalRounding.Minutes(summary.AverageTotalMs),
            AverageNightMinutes = ClinicalRounding.Minutes(summary.AverageNightMs),
            AverageNapMinutes = ClinicalRounding.Minutes(summary.AverageNapMs),
            NapsPerDay = ClinicalRounding.OneDecimal(summary.NapsPerDay),
            DaysCounted = summary.DaysCounted,
            LongestStretchMinutes = ClinicalRounding.Minutes(summary.LongestStretchMs),
            LongestStretchStartedAt = summary.LongestStretchStartedAt,
            BedtimeMedian = ClinicalRounding.Clock(summary.BedtimeMedian),
            WakeMedian = ClinicalRounding.Clock(summary.WakeMedian),
        };
    }
}

/// <summary>Feeding of one local day: feeds that started that day, bottle ml logged and the feeds by method.</summary>
public sealed record FeedingDayResponse
{
    public DateOnly Date { get; init; }

    public int Feeds { get; init; }

    public double BottleMl { get; init; }

    public int Breast { get; init; }

    public int Bottle { get; init; }

    public int Solid { get; init; }

    public static implicit operator FeedingDayResponse(FeedingDaySummary day)
    {
        ArgumentNullException.ThrowIfNull(day);
        return new FeedingDayResponse
        {
            Date = day.Date,
            Feeds = day.Feeds,
            BottleMl = ClinicalRounding.OneDecimal(day.BottleMl),
            Breast = day.Breast,
            Bottle = day.Bottle,
            Solid = day.Solid,
        };
    }
}

/// <summary>A formula the bottles were made with (<see cref="Name"/> is empty when no bottle named it).</summary>
public sealed record FormulaUsageResponse
{
    public Guid? FormulaId { get; init; }

    public string Name { get; init; } = string.Empty;

    public int Feeds { get; init; }

    public double Ml { get; init; }

    public static implicit operator FormulaUsageResponse(FormulaUsage usage)
    {
        ArgumentNullException.ThrowIfNull(usage);
        return new FormulaUsageResponse { FormulaId = usage.FormulaId, Name = usage.Name, Feeds = usage.Feeds, Ml = ClinicalRounding.OneDecimal(usage.Ml) };
    }
}

/// <summary>The feeding section: per-day rows, the averages over the completed days with data and the mean gap between feeds.</summary>
public sealed record FeedingSectionResponse
{
    public IReadOnlyList<FeedingDayResponse> Days { get; init; } = [];

    public double? FeedsPerDay { get; init; }

    public int? AverageIntervalMinutes { get; init; }

    public double? BottleMlPerDay { get; init; }

    public int BreastCount { get; init; }

    public int BottleCount { get; init; }

    public int SolidCount { get; init; }

    public IReadOnlyList<FormulaUsageResponse> Formulas { get; init; } = [];

    public static implicit operator FeedingSectionResponse(FeedingSummary summary)
    {
        ArgumentNullException.ThrowIfNull(summary);
        return new FeedingSectionResponse
        {
            Days = summary.Days.Select(day => (FeedingDayResponse)day).ToArray(),
            FeedsPerDay = ClinicalRounding.OneDecimal(summary.FeedsPerDay),
            AverageIntervalMinutes = ClinicalRounding.Minutes(summary.AverageIntervalMs),
            BottleMlPerDay = ClinicalRounding.OneDecimal(summary.BottleMlPerDay),
            BreastCount = summary.BreastCount,
            BottleCount = summary.BottleCount,
            SolidCount = summary.SolidCount,
            Formulas = summary.Formulas.Select(usage => (FormulaUsageResponse)usage).ToArray(),
        };
    }
}

/// <summary>Diaper changes of one local day; <see cref="Wet"/> counts WET and MIXED, <see cref="Dirty"/> DIRTY and MIXED.</summary>
public sealed record DiaperDayResponse
{
    public DateOnly Date { get; init; }

    public int Total { get; init; }

    public int Wet { get; init; }

    public int Dirty { get; init; }

    public static implicit operator DiaperDayResponse(DiaperDaySummary day)
    {
        ArgumentNullException.ThrowIfNull(day);
        return new DiaperDayResponse { Date = day.Date, Total = day.Total, Wet = day.Wet, Dirty = day.Dirty };
    }
}

/// <summary>The diaper section: per-day rows and the averages over the completed days with changes.</summary>
public sealed record DiaperSectionResponse
{
    public IReadOnlyList<DiaperDayResponse> Days { get; init; } = [];

    public double? PerDay { get; init; }

    public double? WetPerDay { get; init; }

    public double? DirtyPerDay { get; init; }

    public static implicit operator DiaperSectionResponse(DiaperSummary summary)
    {
        ArgumentNullException.ThrowIfNull(summary);
        return new DiaperSectionResponse
        {
            Days = summary.Days.Select(day => (DiaperDayResponse)day).ToArray(),
            PerDay = ClinicalRounding.OneDecimal(summary.PerDay),
            WetPerDay = ClinicalRounding.OneDecimal(summary.WetPerDay),
            DirtyPerDay = ClinicalRounding.OneDecimal(summary.DirtyPerDay),
        };
    }
}

/// <summary>
/// The symptom section: the non-deleted temperature, symptom, spit-up, belly pain and teething events that started in the
/// range, newest first, at most <see cref="SymptomsSectionResponse.MaxItems"/>.
/// </summary>
public sealed record SymptomsSectionResponse
{
    public const int MaxItems = 200;

    public IReadOnlyList<EventResponse> Items { get; init; } = [];
}

/// <summary>A medication and how often it was given in the range.</summary>
public sealed record MedicationDoseCountResponse
{
    public Guid? MedicationId { get; init; }

    public string Name { get; init; } = string.Empty;

    public int Count { get; init; }

    public DateTimeOffset LastGivenAt { get; init; }

    public static implicit operator MedicationDoseCountResponse(MedicationUsage usage)
    {
        ArgumentNullException.ThrowIfNull(usage);
        return new MedicationDoseCountResponse { MedicationId = usage.MedicationId, Name = usage.Name, Count = usage.Count, LastGivenAt = usage.LastGivenAt };
    }
}

/// <summary>The medication section: the doses given in the range per medication (most given first) and the baby's active prescriptions.</summary>
public sealed record MedicationsSectionResponse
{
    public IReadOnlyList<MedicationDoseCountResponse> Doses { get; init; } = [];

    public IReadOnlyList<PrescriptionResponse> ActivePrescriptions { get; init; } = [];
}

/// <summary>A dose that is due or overdue today, with the vaccine and dose names per language.</summary>
public sealed record DueDoseResponse
{
    public string DoseId { get; init; } = string.Empty;

    public string VaccineKey { get; init; } = string.Empty;

    public IReadOnlyDictionary<string, string> VaccineNames { get; init; } = new Dictionary<string, string>();

    public IReadOnlyDictionary<string, string> DoseLabel { get; init; } = new Dictionary<string, string>();

    /// <summary><c>due</c> or <c>overdue</c>.</summary>
    public string State { get; init; } = string.Empty;

    public DateOnly DueOn { get; init; }

    public static implicit operator DueDoseResponse(DueDose dose)
    {
        ArgumentNullException.ThrowIfNull(dose);
        return new DueDoseResponse
        {
            DoseId = dose.DoseId,
            VaccineKey = dose.VaccineKey,
            VaccineNames = dose.VaccineNames.Values,
            DoseLabel = dose.DoseLabel.Values,
            State = dose.State == DoseState.Overdue ? "overdue" : "due",
            DueOn = dose.DueOn,
        };
    }
}

/// <summary>The vaccine section: where the schedule stands today (counts of given, due, overdue and upcoming doses) and the due ones.</summary>
public sealed record VaccinesSectionResponse
{
    public int Given { get; init; }

    public int Due { get; init; }

    public int Overdue { get; init; }

    public int Upcoming { get; init; }

    public IReadOnlyList<DueDoseResponse> DueDoses { get; init; } = [];

    public static implicit operator VaccinesSectionResponse(VaccineOverview overview)
    {
        ArgumentNullException.ThrowIfNull(overview);
        return new VaccinesSectionResponse
        {
            Given = overview.Given,
            Due = overview.Due,
            Overdue = overview.Overdue,
            Upcoming = overview.Upcoming,
            DueDoses = overview.DueDoses.Select(dose => (DueDoseResponse)dose).ToArray(),
        };
    }
}

/// <summary>The growth section: every measurement, oldest date first.</summary>
public sealed record GrowthSectionResponse
{
    public IReadOnlyList<MeasurementResponse> Measurements { get; init; } = [];
}

/// <summary>The formula section: the current formula (<c>null</c> when none) and the baby's formulas, newest first.</summary>
public sealed record FormulasSectionResponse
{
    public FormulaResponse? Current { get; init; }

    public IReadOnlyList<FormulaResponse> History { get; init; } = [];
}
