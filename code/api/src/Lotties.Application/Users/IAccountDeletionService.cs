namespace Lotties.Application.Users;

/// <summary>Deletes the current user's account (store requirement: Apple 5.1.1(v), Google Play account deletion).</summary>
public interface IAccountDeletionService
{
    Task<AccountDeletionPreviewResponse> PreviewAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Erases the user's data and anonymizes the user row, then asks the identity provider to remove the sign-in
    /// account. Throws <see cref="Domain.Exceptions.AccountDeletionBlockedException"/> (409) when the user is the only
    /// owner of a baby that other members still use.
    /// </summary>
    Task<AccountDeletionResponse> DeleteAsync(CancellationToken cancellationToken = default);
}

/// <summary>Removes the sign-in account at the identity provider; the default does nothing (no admin credentials configured).</summary>
public interface IIdentityAccountRemover
{
    /// <summary>Returns whether the account is gone at the provider. Never throws for a provider failure: the data is already erased.</summary>
    Task<bool> RemoveAsync(string issuer, string subject, CancellationToken cancellationToken = default);
}
