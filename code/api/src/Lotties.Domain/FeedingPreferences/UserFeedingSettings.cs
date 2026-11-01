using Lotties.Domain.Common;

namespace Lotties.Domain.FeedingPreferences;

/// <summary>
/// A user's feeding preferences (one row per user, created on the first <c>PUT /me/feeding-settings</c>; no row means every
/// preference is at its default). Today only <see cref="TimeBottleFeedings"/>: whether a bottle she logs runs as a timer
/// (docs/design/20-feeding-amounts.md section 3). It follows the person, not a baby: it is not part of a baby's backup file and
/// goes with her account.
/// </summary>
public sealed class UserFeedingSettings
{
    private UserFeedingSettings()
    {
    }

    private UserFeedingSettings(Guid userId)
    {
        UserId = userId;
    }

    public Guid UserId { get; private set; }

    /// <summary>Whether a bottle starts as a running timer (stopped later, with what was drunk) instead of being logged at once.</summary>
    public bool TimeBottleFeedings { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static UserFeedingSettings Create(Guid userId, bool timeBottleFeedings, DateTimeOffset now)
    {
        var settings = new UserFeedingSettings(Ids.Required(userId, nameof(userId)));
        settings.Apply(timeBottleFeedings, now);
        return settings;
    }

    /// <summary>Replaces the preference; the same value changes nothing (not even <see cref="UpdatedAt"/>).</summary>
    public void ChangeTimeBottleFeedings(bool timeBottleFeedings, DateTimeOffset now)
    {
        if (TimeBottleFeedings == timeBottleFeedings)
        {
            return;
        }

        Apply(timeBottleFeedings, now);
    }

    private void Apply(bool timeBottleFeedings, DateTimeOffset now)
    {
        TimeBottleFeedings = timeBottleFeedings;
        UpdatedAt = UtcTime.Normalize(now);
    }
}
