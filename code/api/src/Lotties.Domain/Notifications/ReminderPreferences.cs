using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Notifications;

/// <summary>
/// One member's reminder choices for one baby: which kinds are on and how early each is sent. Everything is off by
/// default; dose lead 0, 5 or 15 minutes (default 0); nap lead 0, 10 or 20 minutes (default 10).
/// </summary>
public readonly record struct ReminderPreferences
{
    public static readonly IReadOnlyList<int> DoseLeadOptions = [0, 5, 15];
    public static readonly IReadOnlyList<int> NapLeadOptions = [0, 10, 20];

    private ReminderPreferences(bool doseDue, int doseLeadMinutes, bool napWindow, int napLeadMinutes)
    {
        DoseDue = doseDue;
        DoseLeadMinutes = doseLeadMinutes;
        NapWindow = napWindow;
        NapLeadMinutes = napLeadMinutes;
    }

    public static ReminderPreferences Default { get; } = new(false, 0, false, 10);

    public bool DoseDue { get; }

    public int DoseLeadMinutes { get; }

    public bool NapWindow { get; }

    public int NapLeadMinutes { get; }

    public TimeSpan DoseLead => TimeSpan.FromMinutes(DoseLeadMinutes);

    public TimeSpan NapLead => TimeSpan.FromMinutes(NapLeadMinutes);

    /// <summary>Whether any reminder kind is on (the baby is a scheduler candidate for this member).</summary>
    public bool WantsAny => DoseDue || NapWindow;

    public static ReminderPreferences Create(bool doseDue, int doseLeadMinutes, bool napWindow, int napLeadMinutes) =>
        new(
            doseDue,
            Allowed(doseLeadMinutes, DoseLeadOptions, "doseLeadMinutes"),
            napWindow,
            Allowed(napLeadMinutes, NapLeadOptions, "napLeadMinutes"));

    private static int Allowed(int minutes, IReadOnlyList<int> options, string field) =>
        options.Contains(minutes)
            ? minutes
            : throw new DomainValidationException(field, $"{field} must be one of {string.Join(", ", options)}.");
}
