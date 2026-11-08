using Lotties.Domain.Stores;

namespace Lotties.Application.Stores;

/// <summary>
/// The data stores one request or one job may use (docs/design/47-bring-your-own-database.md section 3.6; scoped, one per DI
/// scope). Every data-plane repository reads and writes through the store bound here for the baby it works on and fails
/// closed (<c>store_scope_missing</c>) for a baby that was not entered: there is no default store and no fallback to the
/// built-in one. The HTTP routes under <c>/babies/{babyId}</c> enter the route's baby after authorization; everything else
/// (jobs, the voice assistants, the demo, the doctor's patient list, a backup restore, account erasure) enters each baby
/// itself, right after deciding it may work on it.
/// </summary>
public interface IStoreScope
{
    /// <summary>
    /// Binds <paramref name="babyId"/> to the store resolved for it (<see cref="IStoreResolver"/>), once per baby per scope;
    /// entering it again changes nothing. Throws <c>store_unavailable</c> when that store cannot be used, before anything is bound.
    /// </summary>
    Task EnterAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Binds <paramref name="babyId"/> only when its pointer (read in the control plane) names the built-in store, and returns
    /// <c>true</c>; for a baby on an external store returns <c>false</c> without binding it and without opening that store (no
    /// connection, no migrator, no circuit breaker). For work that never runs on a family's own database: the push reminders
    /// (docs/design/47-bring-your-own-database.md D9, task T11) and the data-table work done through the control context.
    /// </summary>
    Task<bool> TryEnterBuiltInAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>The route bound for <paramref name="babyId"/>; <c>store_scope_missing</c> when the baby was not entered.</summary>
    StoreRoute RouteOf(Guid babyId);
}
