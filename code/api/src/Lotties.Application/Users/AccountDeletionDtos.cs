using Lotties.Domain.Users;

namespace Lotties.Application.Users;

/// <summary>A baby named in the deletion preview.</summary>
public sealed class AccountDeletionBabyResponse
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public static implicit operator AccountDeletionBabyResponse(AccountDeletionBaby baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        return new AccountDeletionBabyResponse { Id = baby.Id, Name = baby.Name };
    }
}

/// <summary>
/// <c>GET /api/v1/me/deletion-preview</c>: babies erased with the account, babies that stay for the other members, and
/// babies that block the deletion until ownership moves.
/// </summary>
public sealed class AccountDeletionPreviewResponse
{
    public IReadOnlyList<AccountDeletionBabyResponse> DeletedBabies { get; set; } = [];

    public IReadOnlyList<AccountDeletionBabyResponse> SharedBabies { get; set; } = [];

    public IReadOnlyList<AccountDeletionBabyResponse> BlockedBabies { get; set; } = [];

    public bool CanDelete { get; set; }

    /// <summary>
    /// Whether this server will ask the identity provider to remove the sign-in account too (an admin client is
    /// configured for the user's issuer); when false the account stays and the app says so before the deletion.
    /// </summary>
    public bool IdentityRemovable { get; set; }

    /// <summary>
    /// The babies of <see cref="DeletedBabies"/> whose records (or a copy a move left) are in the user's own database
    /// (docs/design/47-bring-your-own-database.md section 9): the app offers to delete them there too (<c>wipeOwnDatabase</c>).
    /// </summary>
    public IReadOnlyList<AccountDeletionBabyResponse> OwnDatabaseBabies { get; set; } = [];

    public static AccountDeletionPreviewResponse For(AccountDeletionPlan plan, bool identityRemovable, IReadOnlyCollection<Guid> ownDatabaseBabyIds)
    {
        ArgumentNullException.ThrowIfNull(plan);
        ArgumentNullException.ThrowIfNull(ownDatabaseBabyIds);
        return new AccountDeletionPreviewResponse
        {
            DeletedBabies = [.. plan.Deleted.Select(baby => (AccountDeletionBabyResponse)baby)],
            OwnDatabaseBabies = [.. plan.Deleted.Where(baby => ownDatabaseBabyIds.Contains(baby.Id)).Select(baby => (AccountDeletionBabyResponse)baby)],
            SharedBabies = [.. plan.Left.Select(baby => (AccountDeletionBabyResponse)baby)],
            BlockedBabies = [.. plan.Blocked.Select(baby => (AccountDeletionBabyResponse)baby)],
            CanDelete = plan.Blocked.Count == 0,
            IdentityRemovable = identityRemovable,
        };
    }
}

/// <summary>
/// <c>DELETE /api/v1/me</c> options (query string). <see cref="WipeOwnDatabase"/> (default false, opt-in): also delete, in the user's own
/// database, the records of the babies erased with the account (docs/design/47-bring-your-own-database.md section 9). Without it her
/// database is left as it is.
/// </summary>
public sealed class AccountDeletionRequest
{
    public bool WipeOwnDatabase { get; set; }
}

/// <summary>
/// <c>DELETE /api/v1/me</c> result. The Lotties data is always erased by then; <see cref="Identity"/> says what happened to
/// the sign-in account (<c>removed</c>, <c>not_configured</c>, <c>failed</c>) and <see cref="IdentityRemoved"/> is its
/// boolean form (kept for older clients). With <c>wipeOwnDatabase</c>, <see cref="OwnDatabaseWiped"/> and
/// <see cref="OwnDatabaseNotWiped"/> list the babies whose records in her own database were deleted, or could not be (the database
/// was unreachable, slow or refused; they are still there and Lotties can no longer reach it); both are empty otherwise.
/// </summary>
public sealed class AccountDeletionResponse
{
    public bool IdentityRemoved => Identity == IdentityRemoval.Removed;

    public IdentityRemoval Identity { get; set; }

    public IReadOnlyList<Guid> OwnDatabaseWiped { get; set; } = [];

    public IReadOnlyList<Guid> OwnDatabaseNotWiped { get; set; } = [];
}
