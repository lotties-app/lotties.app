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

    public static AccountDeletionPreviewResponse For(AccountDeletionPlan plan)
    {
        ArgumentNullException.ThrowIfNull(plan);
        return new AccountDeletionPreviewResponse
        {
            DeletedBabies = [.. plan.Deleted.Select(baby => (AccountDeletionBabyResponse)baby)],
            SharedBabies = [.. plan.Left.Select(baby => (AccountDeletionBabyResponse)baby)],
            BlockedBabies = [.. plan.Blocked.Select(baby => (AccountDeletionBabyResponse)baby)],
            CanDelete = plan.Blocked.Count == 0,
        };
    }
}

/// <summary><c>DELETE /api/v1/me</c> result: whether the sign-in account at the identity provider was removed too.</summary>
public sealed class AccountDeletionResponse
{
    public bool IdentityRemoved { get; set; }
}
