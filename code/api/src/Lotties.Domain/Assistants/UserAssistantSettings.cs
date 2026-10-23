using Lotties.Domain.Common;

namespace Lotties.Domain.Assistants;

/// <summary>
/// A user's voice assistant settings (one row per user, created on the first <c>PUT /me/assistant-settings</c>):
/// the baby an assistant command is about when the user may log for several (docs/design/32-assistants.md).
/// <see cref="DefaultBabyId"/> is <c>null</c> when none is chosen; a chosen baby the user no longer logs for is ignored
/// by <see cref="AssistantBabyChoice"/>, never trusted.
/// </summary>
public sealed class UserAssistantSettings
{
    private UserAssistantSettings()
    {
    }

    private UserAssistantSettings(Guid userId)
    {
        UserId = userId;
    }

    public Guid UserId { get; private set; }

    public Guid? DefaultBabyId { get; private set; }

    public DateTimeOffset UpdatedAt { get; private set; }

    public static UserAssistantSettings Create(Guid userId, Guid? defaultBabyId, DateTimeOffset now)
    {
        var settings = new UserAssistantSettings(Ids.Required(userId, nameof(userId)));
        settings.Apply(defaultBabyId, now);
        return settings;
    }

    /// <summary>Replaces the default baby; the same value changes nothing (not even <see cref="UpdatedAt"/>).</summary>
    public void ChangeDefaultBaby(Guid? defaultBabyId, DateTimeOffset now)
    {
        if (DefaultBabyId == NormalizedBaby(defaultBabyId))
        {
            return;
        }

        Apply(defaultBabyId, now);
    }

    private void Apply(Guid? defaultBabyId, DateTimeOffset now)
    {
        DefaultBabyId = NormalizedBaby(defaultBabyId);
        UpdatedAt = UtcTime.Normalize(now);
    }

    private static Guid? NormalizedBaby(Guid? babyId) => babyId == Guid.Empty ? null : babyId;
}
