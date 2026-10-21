namespace Lotties.Domain.Events;

/// <summary>
/// Reserved payload keys of a paused/resumed timer (any event type): <see cref="PauseCount"/> (whole number,
/// 0-<see cref="MaxPauseCount"/>), <see cref="PausedSeconds"/> (whole seconds of all finished pauses,
/// 0-<see cref="MaxPausedSeconds"/>) and <see cref="PausedAt"/> (ISO-8601 instant the current pause began; present only
/// while the timer is paused). See <see cref="EventPauseRules"/> and <see cref="EffectiveDuration"/>.
/// </summary>
public static class PauseFields
{
    public const string PauseCount = "pause_count";
    public const string PausedSeconds = "paused_seconds";
    public const string PausedAt = "paused_at";

    public const int MaxPauseCount = 100;

    /// <summary>One day.</summary>
    public const int MaxPausedSeconds = 86_400;
}
