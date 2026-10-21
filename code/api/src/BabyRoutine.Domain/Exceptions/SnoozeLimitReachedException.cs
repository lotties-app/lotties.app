namespace BabyRoutine.Domain.Exceptions;

/// <summary>A reminder was already snoozed the maximum number of times (<c>Notifications.NotificationRules.MaxSnoozes</c>).</summary>
public sealed class SnoozeLimitReachedException : DomainException
{
    public SnoozeLimitReachedException(string baseKey, int maxSnoozes)
        : base("snooze_limit_reached", $"This reminder was already snoozed {maxSnoozes} times.")
    {
        BaseKey = baseKey;
    }

    public string BaseKey { get; }
}
