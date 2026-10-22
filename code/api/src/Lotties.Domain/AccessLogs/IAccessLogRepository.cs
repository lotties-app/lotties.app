namespace Lotties.Domain.AccessLogs;

/// <summary>Persistence for <see cref="AccessLogEntry"/> (append only).</summary>
public interface IAccessLogRepository
{
    /// <summary>When <paramref name="userId"/>'s latest entry on <paramref name="babyId"/> was recorded, or <c>null</c>.</summary>
    Task<DateTimeOffset?> FindLatestAtAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default);

    /// <summary>The baby's newest entries, newest first, at most <paramref name="limit"/>; not tracked.</summary>
    Task<IReadOnlyList<AccessLogEntry>> ListNewestAsync(Guid babyId, int limit, CancellationToken cancellationToken = default);

    /// <summary>Saves a new entry. Returns <c>false</c>, leaving nothing tracked, when the same entry was saved first (concurrent request).</summary>
    Task<bool> TryAddAsync(AccessLogEntry entry, CancellationToken cancellationToken = default);
}
