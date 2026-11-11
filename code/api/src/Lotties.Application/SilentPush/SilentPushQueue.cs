using Lotties.Domain.SilentPush;

namespace Lotties.Application.SilentPush;

/// <summary>
/// The pending change batches of this API instance, one per baby, and when each baby was last pushed
/// (docs/design/37b-widget-silent-push.md section 4.3). In memory: a restart drops what is pending (at worst a missed
/// push; the next app open syncs anyway). Thread-safe: request threads add, the worker takes.
/// </summary>
public sealed class SilentPushQueue
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, BabyChangeBatch> _pending = [];
    private readonly Dictionary<Guid, DateTimeOffset> _lastPushedAt = [];

    /// <summary>How many babies have changes waiting.</summary>
    public int PendingCount
    {
        get
        {
            lock (_gate)
            {
                return _pending.Count;
            }
        }
    }

    /// <summary>Adds one change of <paramref name="babyId"/> by <paramref name="origin"/> at <paramref name="at"/> to the baby's batch.</summary>
    public void Add(Guid babyId, SilentPushOrigin origin, DateTimeOffset at)
    {
        ArgumentNullException.ThrowIfNull(origin);
        lock (_gate)
        {
            _pending[babyId] = _pending.TryGetValue(babyId, out var batch) ? batch.With(origin) : BabyChangeBatch.Start(babyId, origin, at);
        }
    }

    /// <summary>
    /// Removes and returns the batches due at <paramref name="now"/>, oldest first, and records <paramref name="now"/> as
    /// their baby's last push (the interval counts from the take, so a slow send never lets a second push through). Push
    /// times older than the interval are forgotten.
    /// </summary>
    public IReadOnlyList<BabyChangeBatch> TakeDue(DateTimeOffset now, SilentPushTiming timing)
    {
        ArgumentNullException.ThrowIfNull(timing);
        lock (_gate)
        {
            ForgetPushesBefore(now - timing.MinInterval);
            var due = _pending.Values.Where(batch => batch.DueAt(LastPushedAt(batch.BabyId), timing) <= now).OrderBy(batch => batch.FirstChangeAt).ToArray();
            Array.ForEach(due, batch => MarkTaken(batch.BabyId, now));
            return due;
        }
    }

    private DateTimeOffset? LastPushedAt(Guid babyId) => _lastPushedAt.TryGetValue(babyId, out var at) ? at : null;

    private void MarkTaken(Guid babyId, DateTimeOffset now)
    {
        _pending.Remove(babyId);
        _lastPushedAt[babyId] = now;
    }

    private void ForgetPushesBefore(DateTimeOffset cutoff)
    {
        var stale = _lastPushedAt.Where(entry => entry.Value < cutoff).Select(entry => entry.Key).ToArray();
        Array.ForEach(stale, babyId => _lastPushedAt.Remove(babyId));
    }
}
