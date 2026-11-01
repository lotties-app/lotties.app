namespace Lotties.Domain.Users;

/// <summary>What deleting a user's account does to each baby the user belongs to.</summary>
public sealed record AccountDeletionPlan(
    IReadOnlyList<AccountDeletionBaby> Deleted,
    IReadOnlyList<AccountDeletionBaby> Left,
    IReadOnlyList<AccountDeletionBaby> Blocked);

/// <summary>A baby named in an <see cref="AccountDeletionPlan"/>.</summary>
public sealed record AccountDeletionBaby(Guid Id, string Name);

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
    /// Applies the plan in one transaction and anonymizes the user row. Throws
    /// <see cref="Exceptions.AccountDeletionBlockedException"/> when a baby is blocked; nothing changes then.
    /// </summary>
    Task EraseAsync(Guid userId, string anonymousName, DateTimeOffset now, CancellationToken cancellationToken = default);
}
