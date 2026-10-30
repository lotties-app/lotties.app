using System.Globalization;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Rest;

/// <summary>
/// One weekly work window in the person's own time zone (docs/design/41-caregiver-rest.md R6). <see cref="Days"/> are ISO
/// numbers 1 (Monday) to 7 (Sunday); an <see cref="End"/> before <see cref="Start"/> is an overnight window that belongs to
/// the day it starts.
/// </summary>
public sealed record RestWorkWindow(IReadOnlyList<int> Days, TimeOnly Start, TimeOnly End);

/// <summary>
/// A person's rest settings (docs/design/41 section 3 and 11). Pure value: persistence and the wire shape live in the layers
/// above. <see cref="Validate"/> holds the rules the API reuses (it throws <see cref="DomainValidationException"/> with the
/// wire field name).
/// </summary>
public sealed record RestSettings(
    bool Enabled,
    string TimeZone,
    IReadOnlyList<RestWorkWindow> WorkWindows,
    TimeOnly NightStart,
    TimeOnly NightEnd,
    int FallAsleepMinutes,
    int WakeLeadMinutes)
{
    public const int MaxWorkWindows = 14;
    public const int MinMinutes = 5;
    public const int MaxMinutes = 60;

    /// <summary>What a person without a stored row has: the feature off, UTC, no work windows, night 19:00 to 07:00, 20 and 20.</summary>
    public static RestSettings Defaults { get; } = new(false, "UTC", [], new TimeOnly(19, 0), new TimeOnly(7, 0), 20, 20);

    /// <summary>Parses the wire wall-clock <c>HH:mm</c> (exactly that shape).</summary>
    public static bool TryParseClock(string? text, out TimeOnly value)
    {
        value = default;
        return text is { Length: 5 }
            && text[2] == ':'
            && TimeOnly.TryParseExact(text, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out value);
    }

    /// <summary>The wire form of a wall-clock time, <c>HH:mm</c>.</summary>
    public static string FormatClock(TimeOnly value) => value.ToString("HH:mm", CultureInfo.InvariantCulture);

    /// <summary>Throws <see cref="DomainValidationException"/> (field = the wire name) when a rule of section 11 is broken.</summary>
    public void Validate()
    {
        if (string.IsNullOrWhiteSpace(TimeZone) || !TimeZoneInfo.TryFindSystemTimeZoneById(TimeZone, out _))
        {
            throw new DomainValidationException("timeZone", "timeZone must be a valid IANA time zone id.");
        }

        if (WorkWindows is null)
        {
            throw new DomainValidationException("workWindows", "workWindows is required.");
        }

        if (WorkWindows.Count > MaxWorkWindows)
        {
            throw new DomainValidationException("workWindows", $"At most {MaxWorkWindows} work windows are allowed.");
        }

        for (var i = 0; i < WorkWindows.Count; i++)
        {
            var window = WorkWindows[i];
            var field = $"workWindows[{i}]";
            if (window.Days is null || window.Days.Count is < 1 or > 7 || window.Days.Any(d => d is < 1 or > 7) || window.Days.Distinct().Count() != window.Days.Count)
            {
                throw new DomainValidationException($"{field}.days", "days must hold 1 to 7 distinct ISO day numbers (1 = Monday to 7 = Sunday).");
            }

            if (window.Start == window.End)
            {
                throw new DomainValidationException($"{field}.end", "A work window's start and end must differ.");
            }
        }

        if (NightStart == NightEnd)
        {
            throw new DomainValidationException("nightEnd", "nightStart and nightEnd must differ.");
        }

        if (FallAsleepMinutes is < MinMinutes or > MaxMinutes)
        {
            throw new DomainValidationException("fallAsleepMinutes", $"fallAsleepMinutes must be {MinMinutes} to {MaxMinutes}.");
        }

        if (WakeLeadMinutes is < MinMinutes or > MaxMinutes)
        {
            throw new DomainValidationException("wakeLeadMinutes", $"wakeLeadMinutes must be {MinMinutes} to {MaxMinutes}.");
        }
    }
}
