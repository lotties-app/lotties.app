namespace Lotties.Application.Rhythm;

/// <summary>Computes a baby's rhythm from her own recent events (docs/design/48-baby-rhythm.md); nothing is stored.</summary>
public interface IRhythmService
{
    /// <summary>
    /// The rhythm of <paramref name="babyId"/> as of <paramref name="now"/>, or <c>null</c> when the baby does not exist.
    /// Local times are read in <paramref name="timeZone"/> (an IANA id, daylight saving applied per event) when the host
    /// knows it, else with the offset of <paramref name="now"/>.
    /// </summary>
    Task<RhythmResponse?> GetAsync(Guid babyId, DateTimeOffset now, string? timeZone = null, CancellationToken cancellationToken = default);
}
