namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// What the community statistics job reads (docs/design/34-community-insights.md section 5.3), used only while
/// <c>CommunityAggregation:ReadEvents</c> is on. Read-only; nothing is tracked or written.
/// </summary>
public interface ICommunityEventSource
{
    /// <summary>
    /// Control plane only: of <paramref name="eligibleBabyIds"/> (the run's population snapshot), the babies whose latest consent line is
    /// still a yes under <paramref name="textVersion"/> and that have no demo member, each with her family, stored birth date and the
    /// time of that line. A baby missing anything is left out.
    /// </summary>
    Task<IReadOnlyList<CommunitySubject>> SubjectsAsync(IReadOnlyList<Guid> eligibleBabyIds, string textVersion, CancellationToken cancellationToken = default);

    /// <summary>
    /// Data plane: the facts (<see cref="CommunityEventRows"/>) of the live events of the read types that <paramref name="babyId"/>'s
    /// records hold and that started from <paramref name="startedFrom"/> to before <paramref name="startedBefore"/>; <c>null</c> without
    /// reading anything when her records are not on the built-in store (fail closed: a family's own database is never opened).
    /// </summary>
    Task<CommunityEventRows?> ReadAsync(Guid babyId, DateTimeOffset startedFrom, DateTimeOffset startedBefore, CancellationToken cancellationToken = default);
}
