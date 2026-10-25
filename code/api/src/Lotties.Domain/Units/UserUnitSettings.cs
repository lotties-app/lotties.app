using Lotties.Domain.Common;

namespace Lotties.Domain.Units;

/// <summary>
/// A user's measurement unit setting (one row per user, created on the first <c>PUT /me/unit-settings</c>; no row means
/// <see cref="UnitSetting.Auto"/>). Not baby data and not part of a baby's backup file: it follows the person, and goes
/// with her account (docs/design/37-measurement-units.md). Storage of measurements stays metric whatever it says.
/// </summary>
public sealed class UserUnitSettings
{
    private UserUnitSettings()
    {
    }

    private UserUnitSettings(Guid userId)
    {
        UserId = userId;
    }

    public Guid UserId { get; private set; }

    public UnitSetting Setting { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static UserUnitSettings Create(Guid userId, UnitSetting setting, DateTimeOffset now)
    {
        var settings = new UserUnitSettings(Ids.Required(userId, nameof(userId)));
        settings.Apply(setting, now);
        return settings;
    }

    /// <summary>Replaces the setting; the same value changes nothing (not even <see cref="UpdatedAt"/>).</summary>
    public void Change(UnitSetting setting, DateTimeOffset now)
    {
        if (Setting == setting)
        {
            return;
        }

        Apply(setting, now);
    }

    private void Apply(UnitSetting setting, DateTimeOffset now)
    {
        Setting = setting;
        UpdatedAt = UtcTime.Normalize(now);
    }
}
