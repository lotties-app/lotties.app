namespace Lotties.Application.Stores;

/// <summary>
/// Settings of the move of a baby's records between Lotties' database and the family's own (section <c>Stores:Moves</c>, env
/// <c>Stores__Moves__UndoWindowDays</c> ...; docs/design/47-bring-your-own-database.md section 6, task T7). Validated at startup
/// while <c>Stores:Enabled</c> is on; nothing of it is used while the flag is off.
/// </summary>
public sealed class StoreMoveOptions
{
    public const string SectionName = "Stores:Moves";

    /// <summary>Rows written to the target per transaction (default 500, 50 to 5000).</summary>
    public int BatchSize { get; set; } = 500;

    /// <summary>Days the old copy is kept after a move so it can be undone (default 7, 0 to 90; 0 deletes it at the next sweep).</summary>
    public int UndoWindowDays { get; set; } = 7;

    /// <summary>
    /// Seconds the worker waits after a move starts and before it copies (default 5, 0 to 120): requests that were already running
    /// when the baby's writes were blocked finish first. A write that still lands in the source during the copy is caught by the
    /// verification, which copies again once.
    /// </summary>
    public int DrainSeconds { get; set; } = 5;

    /// <summary>Seconds a worker holds a move without renewing it (default 120, 30 to 3600): a stopped worker's move is resumed after it.</summary>
    public int LeaseSeconds { get; set; } = 120;

    /// <summary>Seconds between sweeps for stopped moves, old copies to delete and leftovers (default 60, 5 to 3600).</summary>
    public int SweepSeconds { get; set; } = 60;

    /// <summary>Runs of one move before it is given up (default 3, 1 to 10).</summary>
    public int MaxAttempts { get; set; } = 3;

    /// <summary>Minutes before a failed delete of an old copy or leftovers is tried again (default 60, 1 to 1440).</summary>
    public int CleanupRetryMinutes { get; set; } = 60;

    public TimeSpan UndoWindow => TimeSpan.FromDays(UndoWindowDays);

    public TimeSpan Drain => TimeSpan.FromSeconds(DrainSeconds);

    public TimeSpan Lease => TimeSpan.FromSeconds(LeaseSeconds);

    public TimeSpan Sweep => TimeSpan.FromSeconds(SweepSeconds);

    public TimeSpan CleanupRetry => TimeSpan.FromMinutes(CleanupRetryMinutes);

    /// <summary>The settings that are out of range, empty when all are valid.</summary>
    public IReadOnlyList<string> Problems()
    {
        var problems = new List<string>();
        AddWhenOutside(problems, nameof(BatchSize), BatchSize, 50, 5000);
        AddWhenOutside(problems, nameof(UndoWindowDays), UndoWindowDays, 0, 90);
        AddWhenOutside(problems, nameof(DrainSeconds), DrainSeconds, 0, 120);
        AddWhenOutside(problems, nameof(LeaseSeconds), LeaseSeconds, 30, 3600);
        AddWhenOutside(problems, nameof(SweepSeconds), SweepSeconds, 5, 3600);
        AddWhenOutside(problems, nameof(MaxAttempts), MaxAttempts, 1, 10);
        AddWhenOutside(problems, nameof(CleanupRetryMinutes), CleanupRetryMinutes, 1, 1440);
        if (LeaseSeconds <= DrainSeconds * 2)
        {
            problems.Add($"{SectionName}:{nameof(LeaseSeconds)} must be more than twice {nameof(DrainSeconds)}.");
        }

        return problems;
    }

    private static void AddWhenOutside(List<string> problems, string name, int value, int min, int max)
    {
        if (value < min || value > max)
        {
            problems.Add($"{SectionName}:{name} must be between {min} and {max}.");
        }
    }
}
