using BabyRoutine.Domain.Common;

namespace BabyRoutine.Domain.Notifications;

/// <summary>
/// A named leader lease so that only one API instance runs a background job at a time. Taking it is an optimistic
/// update (the store's concurrency token decides a race); losing means skipping that tick.
/// </summary>
public sealed class JobLease
{
    public const string PushSchedulerName = "push-scheduler";
    public const int NameMaxLength = 40;
    public const int HolderMaxLength = 64;

    private JobLease()
    {
    }

    private JobLease(string name)
    {
        Name = name;
    }

    public string Name { get; private set; } = string.Empty;

    public string HolderId { get; private set; } = string.Empty;

    public DateTimeOffset LeaseUntil { get; private set; }

    /// <summary>A new lease row held by <paramref name="holderId"/> until <paramref name="now"/> + <paramref name="duration"/>.</summary>
    public static JobLease Create(string name, string holderId, DateTimeOffset now, TimeSpan duration)
    {
        var lease = new JobLease(Text.Required(name, "name", NameMaxLength));
        lease.Take(Text.Required(holderId, "holderId", HolderMaxLength), now, duration);
        return lease;
    }

    public bool IsHeldBy(string holderId, DateTimeOffset now) => HolderId == holderId && LeaseUntil > now;

    /// <summary>Takes or renews the lease when it expired or is already <paramref name="holderId"/>'s; returns whether it did.</summary>
    public bool TryAcquire(string holderId, DateTimeOffset now, TimeSpan duration)
    {
        var holder = Text.Required(holderId, "holderId", HolderMaxLength);
        if (HolderId != holder && LeaseUntil > now)
        {
            return false;
        }

        Take(holder, now, duration);
        return true;
    }

    private void Take(string holderId, DateTimeOffset now, TimeSpan duration)
    {
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(duration, TimeSpan.Zero);
        HolderId = holderId;
        LeaseUntil = UtcTime.Normalize(now + duration);
    }
}
