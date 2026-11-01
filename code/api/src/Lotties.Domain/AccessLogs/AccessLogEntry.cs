using Lotties.Domain.Babies;
using Lotties.Domain.Common;

namespace Lotties.Domain.AccessLogs;

/// <summary>What an access log entry records. v1: a Doctor's device loaded the baby's data.</summary>
public enum AccessKind
{
    View,
}

/// <summary>
/// One recorded access of a member to a baby's data (v1: a Doctor loading it, at most once per hour per doctor and
/// baby: <see cref="AccessLogThrottle"/>). Written by the server, read by the baby's Owner, never changed or deleted by
/// the API. The id is derived from the baby, the user and the member's previous entry (<see cref="IdAfter"/>), so every
/// request of a parallel burst that read the same latest entry writes the same row and only one insert wins, also on
/// both sides of an hour boundary (step 1 derived it from the UTC hour, which let 10:59:59 and 11:00:00 both write).
/// </summary>
public sealed class AccessLogEntry
{
    private static readonly Guid IdNamespace = new("5d8a2f43-1c7e-4b5a-9f0e-6a3c2d1b7e94");

    private AccessLogEntry()
    {
    }

    private AccessLogEntry(Guid id, Guid babyId, Guid userId, BabyRole role, AccessKind kind, DateTimeOffset at)
    {
        Id = id;
        BabyId = babyId;
        UserId = userId;
        Role = role;
        Kind = kind;
        At = at;
    }

    public Guid Id { get; private set; }

    public Guid BabyId { get; private set; }

    public Guid UserId { get; private set; }

    /// <summary>The member's role at the time of the access.</summary>
    public BabyRole Role { get; private set; }

    public AccessKind Kind { get; private set; }

    public DateTimeOffset At { get; private set; }

    /// <summary>A view of <paramref name="babyId"/> by <paramref name="userId"/> at <paramref name="now"/>, following her latest entry <paramref name="previous"/> (none for her first).</summary>
    public static AccessLogEntry View(Guid babyId, Guid userId, BabyRole role, DateTimeOffset now, AccessLogEntry? previous = null) =>
        new(
            IdAfter(Ids.Required(babyId, nameof(babyId)), Ids.Required(userId, nameof(userId)), previous?.Id),
            babyId,
            userId,
            BabyRoleRules.EnsureDefined(role),
            AccessKind.View,
            UtcTime.Normalize(now));

    /// <summary>The id of the entry of <paramref name="userId"/> on <paramref name="babyId"/> that follows the entry <paramref name="previousEntryId"/> (<c>null</c>: her first).</summary>
    public static Guid IdAfter(Guid babyId, Guid userId, Guid? previousEntryId) =>
        DeterministicGuid.Create(IdNamespace, $"{babyId:N}|{userId:N}|after|{(previousEntryId is { } previous ? previous.ToString("N") : "first")}");
}
