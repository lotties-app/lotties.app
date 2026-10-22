using System.Text.Json.Serialization;
using Lotties.Application.Babies;
using Lotties.Application.Professionals;
using Lotties.Application.Serialization;
using Lotties.Application.Users;
using Lotties.Domain.AccessLogs;
using Lotties.Domain.Babies;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.AccessLogs;

/// <summary>One access of a member to the baby's data, as the Owner sees it.</summary>
public sealed record AccessLogEntryResponse
{
    public Guid UserId { get; init; }

    /// <summary>The member as the family sees her (<c>null</c> if the account is gone).</summary>
    public PersonSummary? Person { get; init; }

    [JsonConverter(typeof(RoleStringEnumConverter))]
    public BabyRole Role { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public AccessKind Kind { get; init; }

    public DateTimeOffset At { get; init; }

    public static AccessLogEntryResponse For(AccessLogEntry entry, PersonSummary? person)
    {
        ArgumentNullException.ThrowIfNull(entry);
        return new AccessLogEntryResponse { UserId = entry.UserId, Person = person, Role = entry.Role, Kind = entry.Kind, At = entry.At };
    }
}

/// <summary>The baby's access log (docs/design/16-doctor-access.md): written by the server, read by the Owner.</summary>
public interface IAccessLogService
{
    /// <summary>
    /// Records that the caller loaded the baby's data when her role is recorded (a Doctor) and her previous entry is at
    /// least an hour old (<see cref="AccessLogThrottle"/>); otherwise nothing.
    /// </summary>
    Task RecordViewAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>The newest entries, newest first (at most <see cref="AccessLogThrottle.ListLimit"/>).</summary>
    Task<IReadOnlyList<AccessLogEntryResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default);
}

internal sealed class AccessLogService : IAccessLogService
{
    private readonly IAccessLogRepository _entries;
    private readonly IBabyAccessService _access;
    private readonly IPersonDirectory _people;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<AccessLogService> _logger;

    public AccessLogService(
        IAccessLogRepository entries,
        IBabyAccessService access,
        IPersonDirectory people,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<AccessLogService> logger)
    {
        _entries = entries ?? throw new ArgumentNullException(nameof(entries));
        _access = access ?? throw new ArgumentNullException(nameof(access));
        _people = people ?? throw new ArgumentNullException(nameof(people));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task RecordViewAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var role = await _access.FindRoleAsync(babyId, cancellationToken);
        if (role is not { } recorded || !AccessLogThrottle.IsRecorded(recorded))
        {
            return;
        }

        var user = await _currentUser.GetUserAsync(cancellationToken);
        var now = _timeProvider.GetUtcNow();
        var latest = await _entries.FindLatestAsync(babyId, user.Id, cancellationToken);
        if (!AccessLogThrottle.IsDue(latest?.At, now))
        {
            return;
        }

        var added = await _entries.TryAddAsync(AccessLogEntry.View(babyId, user.Id, recorded, now, latest), cancellationToken);
        _logger.LogInformation("Access of user {UserId} ({Role}) to baby {BabyId} recorded: {Added}", user.Id, recorded, babyId, added);
    }

    public async Task<IReadOnlyList<AccessLogEntryResponse>> ListAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var entries = await _entries.ListNewestAsync(babyId, AccessLogThrottle.ListLimit, cancellationToken);
        var people = await _people.DescribeAsync(entries.Select(entry => entry.UserId).ToArray(), cancellationToken);
        return entries.Select(entry => AccessLogEntryResponse.For(entry, people.GetValueOrDefault(entry.UserId))).ToArray();
    }
}
