namespace Lotties.Domain.Rest;

/// <summary>
/// A baby event as the estimator sees it: plain facts, no entity. <see cref="IsBabySleep"/> marks the baby's sleep events
/// (the only ones that start a night, R1/R3); <see cref="CreatedBy"/> is the account that logged it.
/// </summary>
public sealed record RestEvent(
    Guid BabyId,
    bool IsBabySleep,
    DateTimeOffset StartedAt,
    DateTimeOffset? EndedAt,
    Guid CreatedBy,
    DateTimeOffset CreatedAt,
    bool Imported);

/// <summary>
/// Everything one estimate reads. <see cref="Night"/> is the local date (in the settings' zone) the night started;
/// <see cref="Now"/> is passed in (the estimator never reads a clock); <see cref="MorningAnswer"/> is the "up for the day"
/// instant the person confirmed, if any; <see cref="Events"/> are the events of every baby the person belongs to.
/// </summary>
public sealed record RestInput(
    RestSettings Settings,
    Guid PersonId,
    DateOnly Night,
    DateTimeOffset Now,
    DateTimeOffset? MorningAnswer,
    IEnumerable<RestEvent> Events);

public enum RestStatus
{
    Ok,
    NotEnoughLog,
    Disabled,
}

public enum RestStartSource
{
    BabyLog,
    WorkWindowEnd,
}

public enum RestEndSource
{
    OwnEvent,
    Confirmed,
    BabyFinalWake,
    WorkWindow,
    Ongoing,
}

public enum RestConfidence
{
    Normal,
    Low,
}

/// <summary>One stretch the person probably rested. <see cref="End"/> is <c>null</c> while ongoing.</summary>
public sealed record RestPart(
    DateTimeOffset Start,
    DateTimeOffset? End,
    RestStartSource StartSource,
    RestEndSource EndSource,
    RestConfidence Confidence);

public sealed record RestConstants(int FallAsleepMinutes, int WakeLeadMinutes);

/// <summary>The estimate for one person and one night (docs/design/41 section 11). Parts only: no totals, no score.</summary>
public sealed record RestNight(
    DateOnly Night,
    RestStatus Status,
    IReadOnlyList<RestPart> Parts,
    bool AskMorning,
    RestConstants Constants);
