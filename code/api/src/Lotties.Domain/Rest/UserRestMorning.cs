using Lotties.Domain.Common;

namespace Lotties.Domain.Rest;

/// <summary>
/// The moment a person said they were up for the day, for one night (<c>PUT /me/rest/morning</c>); one row per user and
/// night, optional (docs/design/41-caregiver-rest.md R5). Erased with the account, never in a backup or the sync.
/// </summary>
public sealed class UserRestMorning
{
    private UserRestMorning()
    {
    }

    public Guid UserId { get; private set; }

    /// <summary>The local date the night started.</summary>
    public DateOnly Night { get; private set; }

    public DateTimeOffset UpAt { get; private set; }

    public static UserRestMorning Create(Guid userId, DateOnly night, DateTimeOffset upAt) =>
        new() { UserId = Ids.Required(userId, nameof(userId)), Night = night, UpAt = UtcTime.Normalize(upAt) };

    /// <summary>Replaces the answer of that night.</summary>
    public void Answer(DateTimeOffset upAt) => UpAt = UtcTime.Normalize(upAt);
}
