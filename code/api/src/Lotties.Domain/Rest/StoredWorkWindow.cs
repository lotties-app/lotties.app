namespace Lotties.Domain.Rest;

/// <summary>
/// One stored work window of a person: ISO days (1 Monday to 7 Sunday, sorted, distinct), local start and end times in
/// the person's zone (an end before the start is an overnight window that belongs to the day it starts). Validated by
/// the application service (docs/design/41-caregiver-rest.md section 11); never logged.
/// </summary>
public sealed record StoredWorkWindow
{
    public StoredWorkWindow(IEnumerable<int> days, TimeOnly start, TimeOnly end)
    {
        ArgumentNullException.ThrowIfNull(days);
        Days = [.. days.Distinct().Order()];
        Start = start;
        End = end;
    }

    public IReadOnlyList<int> Days { get; }

    public TimeOnly Start { get; }

    public TimeOnly End { get; }

    public bool Equals(StoredWorkWindow? other) =>
        other is not null && Start == other.Start && End == other.End && Days.SequenceEqual(other.Days);

    public override int GetHashCode() => HashCode.Combine(Start, End, Days.Aggregate(0, HashCode.Combine));
}
