using System.Text.Json.Serialization;
using Lotties.Application.Serialization;

namespace Lotties.Application.Users;

/// <summary>Deletes the current user's account (store requirement: Apple 5.1.1(v), Google Play account deletion).</summary>
public interface IAccountDeletionService
{
    Task<AccountDeletionPreviewResponse> PreviewAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Erases the user's data and anonymizes the user row, then asks the identity provider to remove the sign-in
    /// account. Throws <see cref="Domain.Exceptions.AccountDeletionBlockedException"/> (409) when the user is the only
    /// owner of a baby that other members still use, and <see cref="Domain.Exceptions.DataStoreMoveInProgressException"/> (409)
    /// while a move of one of the babies it erases runs. With <see cref="AccountDeletionRequest.WipeOwnDatabase"/> the erased
    /// babies' records in her own database are deleted first; one that cannot be reached is reported, never in the way.
    /// </summary>
    Task<AccountDeletionResponse> DeleteAsync(AccountDeletionRequest request, CancellationToken cancellationToken = default);
}

/// <summary>What happened to the sign-in account at the identity provider when the Lotties account was deleted.</summary>
[JsonConverter(typeof(SnakeCaseStringEnumConverter))]
public enum IdentityRemoval
{
    /// <summary>The account is gone at the provider (or was already).</summary>
    Removed,

    /// <summary>
    /// This server cannot remove it: no admin client is configured (<c>AUTH_ADMIN_CLIENT_ID/SECRET</c>), or the account
    /// belongs to another issuer. The account stays until the operator removes it.
    /// </summary>
    NotConfigured,

    /// <summary>The provider was asked and failed (down, refused): the account stays; the user may sign in and delete again, or ask the operator.</summary>
    Failed,
}

/// <summary>Removes the sign-in account at the identity provider; without admin credentials it does nothing.</summary>
public interface IIdentityAccountRemover
{
    /// <summary>Whether <see cref="RemoveAsync"/> would ask the provider for an account of <paramref name="issuer"/> (shown before the deletion).</summary>
    bool CanRemove(string issuer);

    /// <summary>Removes the account. Never throws for a provider failure: the data is already erased by then.</summary>
    Task<IdentityRemoval> RemoveAsync(string issuer, string subject, CancellationToken cancellationToken = default);
}
