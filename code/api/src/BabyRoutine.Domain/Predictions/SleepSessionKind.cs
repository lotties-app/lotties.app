namespace BabyRoutine.Domain.Predictions;

/// <summary>What a sleep session is when its typical duration is measured: a nap or a night.</summary>
internal enum SleepSessionKind
{
    Nap,
    Night,
}

/// <summary>Classifies sleep sessions (see <see cref="SleepSessions"/>) for kind-aware durations (heuristic v1.1).</summary>
internal static class SleepSessionKinds
{
    /// <summary>
    /// <see cref="SleepSessionKind.Night"/> for night sessions (logged <c>night</c> timers and bed-time nights);
    /// every other session, kind-less ones included, is a <see cref="SleepSessionKind.Nap"/>, as in the web app.
    /// </summary>
    public static SleepSessionKind Of(ObservedEvent session) =>
        session.Kind == SleepKinds.Night ? SleepSessionKind.Night : SleepSessionKind.Nap;
}
