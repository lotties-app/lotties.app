using System.Collections.Concurrent;

namespace Lotties.Infrastructure.AddressLookup;

/// <summary>
/// A small in-memory cache with a time to live and a size cap (emptied when full: a lookup cache has no hot set worth
/// protecting, and a cap keeps a stream of different queries from growing the process). Keys are normalized query texts
/// that stay in memory only; they are never logged.
/// </summary>
internal sealed class AnswerCache<T>(TimeProvider time, TimeSpan timeToLive, int maxEntries)
{
    private readonly ConcurrentDictionary<string, (T Value, DateTimeOffset ExpiresAt)> _entries = new(StringComparer.Ordinal);

    public bool TryGet(string key, out T value)
    {
        if (_entries.TryGetValue(key, out var entry) && entry.ExpiresAt > time.GetUtcNow())
        {
            value = entry.Value;
            return true;
        }

        value = default!;
        return false;
    }

    public void Set(string key, T value)
    {
        if (_entries.Count >= maxEntries)
        {
            var now = time.GetUtcNow();
            foreach (var expired in _entries.Where(entry => entry.Value.ExpiresAt <= now).Select(entry => entry.Key))
            {
                _entries.TryRemove(expired, out _);
            }

            if (_entries.Count >= maxEntries)
            {
                _entries.Clear();
            }
        }

        _entries[key] = (value, time.GetUtcNow() + timeToLive);
    }
}
