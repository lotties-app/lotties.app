using Lotties.Domain.Common;

namespace Lotties.Domain.Rest;

/// <summary>
/// A person's caregiver rest settings (one row per user, created on the first <c>PUT /me/rest-settings</c>; no row means
/// <see cref="Defaults"/>). Not baby data, never in a backup file or the sync, erased with the account
/// (docs/design/41-caregiver-rest.md). The work windows say when a person works: never logged.
/// </summary>
public sealed class UserRestSettings
{
    public const string DefaultTimeZone = "UTC";
    public const int DefaultMinutes = 20;
    public const int MaxWorkWindows = 14;
    public const int MinMinutes = 5;
    public const int MaxMinutes = 60;

    public static readonly TimeOnly DefaultNightStart = new(19, 0);
    public static readonly TimeOnly DefaultNightEnd = new(7, 0);

    private UserRestSettings()
    {
        TimeZone = DefaultTimeZone;
        WorkWindows = [];
    }

    public Guid UserId { get; private set; }

    public bool Enabled { get; private set; }

    public string TimeZone { get; private set; }

    public IReadOnlyList<StoredWorkWindow> WorkWindows { get; private set; }

    public TimeOnly NightStart { get; private set; }

    public TimeOnly NightEnd { get; private set; }

    public int FallAsleepMinutes { get; private set; }

    public int WakeLeadMinutes { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static UserRestSettings Create(Guid userId, RestSettingsValues values, DateTimeOffset now)
    {
        var settings = new UserRestSettings { UserId = Ids.Required(userId, nameof(userId)) };
        settings.Apply(values, now);
        return settings;
    }

    /// <summary>Replaces the whole state; the same state changes nothing (not even <see cref="UpdatedAt"/>).</summary>
    public void Replace(RestSettingsValues values, DateTimeOffset now)
    {
        if (Values().Equals(values))
        {
            return;
        }

        Apply(values, now);
    }

    public RestSettingsValues Values() =>
        new(Enabled, TimeZone, WorkWindows, NightStart, NightEnd, FallAsleepMinutes, WakeLeadMinutes);

    private void Apply(RestSettingsValues values, DateTimeOffset now)
    {
        Enabled = values.Enabled;
        TimeZone = values.TimeZone;
        WorkWindows = [.. values.WorkWindows];
        NightStart = values.NightStart;
        NightEnd = values.NightEnd;
        FallAsleepMinutes = values.FallAsleepMinutes;
        WakeLeadMinutes = values.WakeLeadMinutes;
        UpdatedAt = UtcTime.Normalize(now);
    }
}

/// <summary>The settings a person can set (already validated).</summary>
public sealed record RestSettingsValues(
    bool Enabled,
    string TimeZone,
    IReadOnlyList<StoredWorkWindow> WorkWindows,
    TimeOnly NightStart,
    TimeOnly NightEnd,
    int FallAsleepMinutes,
    int WakeLeadMinutes)
{
    public static readonly RestSettingsValues Defaults = new(
        false,
        UserRestSettings.DefaultTimeZone,
        [],
        UserRestSettings.DefaultNightStart,
        UserRestSettings.DefaultNightEnd,
        UserRestSettings.DefaultMinutes,
        UserRestSettings.DefaultMinutes);

    public bool Equals(RestSettingsValues? other) =>
        other is not null
        && Enabled == other.Enabled
        && TimeZone == other.TimeZone
        && NightStart == other.NightStart
        && NightEnd == other.NightEnd
        && FallAsleepMinutes == other.FallAsleepMinutes
        && WakeLeadMinutes == other.WakeLeadMinutes
        && WorkWindows.SequenceEqual(other.WorkWindows);

    public override int GetHashCode() => HashCode.Combine(Enabled, TimeZone, NightStart, NightEnd, FallAsleepMinutes, WakeLeadMinutes, WorkWindows.Count);
}
