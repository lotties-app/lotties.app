using Lotties.Domain.EventTypes;

namespace Lotties.Domain.Predictions;

/// <summary>
/// Pure strategy for resolving a cold-start prior for a given event type and age. Implementations must be deterministic
/// and free of I/O; they receive all required data through their constructor or method parameters.
/// </summary>
public interface IPriorProvider
{
    /// <summary>Returns a prior for the given type and age, or <c>null</c> when this provider has nothing to contribute.</summary>
    ColdStartPrior? GetPrior(EventTypeKey typeKey, int ageDays);
}