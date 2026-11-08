using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Users;

/// <summary>What deleting a user's account does to each baby the user belongs to.</summary>
public sealed record AccountDeletionPlan(
    IReadOnlyList<AccountDeletionBaby> Deleted,
    IReadOnlyList<AccountDeletionBaby> Left,
    IReadOnlyList<AccountDeletionBaby> Blocked)
{
    /// <summary>The ids of the babies erased with the account.</summary>
    public IReadOnlyList<Guid> DeletedIds => [.. Deleted.Select(baby => baby.Id)];

    /// <summary>Throws <see cref="AccountDeletionBlockedException"/> when a baby blocks the deletion (nothing may change then).</summary>
    public void EnsureNotBlocked()
    {
        if (Blocked.Count > 0)
        {
            throw new AccountDeletionBlockedException([.. Blocked.Select(baby => baby.Id)]);
        }
    }
}

/// <summary>A baby named in an <see cref="AccountDeletionPlan"/>.</summary>
public sealed record AccountDeletionBaby(Guid Id, string Name);

/// <summary>Records of an erased baby that may be in the deleting user's own database (<c>data_stores</c> id <paramref name="StoreId"/>).</summary>
public sealed record OwnStoreCopy(Guid BabyId, Guid StoreId);

/// <summary>
/// What account deletion finds in the user's own databases (docs/design/47-bring-your-own-database.md section 9, task T10): every
/// baby erased with the account that has records there (it points at the store, or a move left an old copy or leftovers there), the
/// user's stores (their descriptors go with the account in every case) and the erased babies whose move a worker is running now.
/// </summary>
public sealed record OwnStoreCopies(IReadOnlyList<OwnStoreCopy> Copies, IReadOnlyList<Guid> StoreIds, IReadOnlyList<Guid> MovingBabyIds)
{
    /// <summary>The babies that have records in one of the user's own databases.</summary>
    public IReadOnlyList<Guid> BabyIds => [.. Copies.Select(copy => copy.BabyId).Distinct()];

    /// <summary>
    /// Throws <see cref="DataStoreMoveInProgressException"/> while a worker moves one of the babies (or deletes its old copy): erasing
    /// it then would let the worker go on writing into a database Lotties is about to forget. The work ends within minutes.
    /// </summary>
    public void EnsureNoMoveRunning()
    {
        if (MovingBabyIds.Count > 0)
        {
            throw new DataStoreMoveInProgressException();
        }
    }
}

/// <summary>What the eraser does with a baby whose records are on an external store (its pointer names one).</summary>
public enum ExternalStoreErasure
{
    /// <summary>The erasure fails with <c>store_unavailable</c> and changes nothing, without opening the store (the demo cleanup).</summary>
    Refuse,

    /// <summary>
    /// A baby erased with the account is erased on Lotties' side only; the caller already deleted its records in the user's own
    /// database, or the user chose to keep them (account deletion, task T10). A baby that stays for other members must still be on
    /// the built-in store (<c>store_unavailable</c> otherwise, nothing changes).
    /// </summary>
    LottiesSideOnly,
}

/// <summary>Bulk removal of a user's data (account deletion). Implemented by the persistence layer.</summary>
public interface IAccountDataEraser
{
    /// <summary>
    /// Classifies the user's babies: <c>Deleted</c> (the user is the only member: the baby and all its data go),
    /// <c>Left</c> (other members remain: only the user's membership and personal records go) and <c>Blocked</c>
    /// (the user is the only owner and others remain: ownership must move first).
    /// </summary>
    Task<AccountDeletionPlan> PlanAsync(Guid userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Finds, among <paramref name="babyIds"/> (the babies erased with the account), the records that may be in a database the user
    /// owns: the store a baby points at and the store a move of it may have left records in, only when that store is one of the
    /// user's <c>data_stores</c> rows (another person's database is never named). Reads the control plane only.
    /// </summary>
    Task<OwnStoreCopies> FindOwnStoreCopiesAsync(Guid userId, IReadOnlyCollection<Guid> babyIds, DateTimeOffset now, CancellationToken cancellationToken = default);

    /// <summary>
    /// Applies the plan in one transaction and anonymizes the user row. Throws
    /// <see cref="AccountDeletionBlockedException"/> when a baby is blocked; nothing changes then.
    /// <paramref name="externalStores"/> says what happens to a baby whose records are on an external store.
    /// </summary>
    Task EraseAsync(Guid userId, string anonymousName, DateTimeOffset now, ExternalStoreErasure externalStores, CancellationToken cancellationToken = default);
}
