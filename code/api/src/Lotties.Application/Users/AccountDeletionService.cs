using Lotties.Application.Stores;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Users;

/// <summary>
/// Account deletion (design 33 G1; for a family's own database, docs/design/47-bring-your-own-database.md section 9, task T10). The
/// recipe: plan, refuse a blocked deletion or one while a move of an erased baby runs, delete the erased babies' records in her own
/// database only when she asked for it (<see cref="AccountDeletionRequest.WipeOwnDatabase"/>, opt-in), erase Lotties' side in one
/// transaction (her store descriptors included, in every case), forget her stores' pools and breakers, then remove the sign-in account.
/// A store that cannot be reached never blocks the erasure: its babies are reported as not wiped.
/// </summary>
internal sealed class AccountDeletionService : IAccountDeletionService
{
    /// <summary>Shown wherever the deleted user's name would appear on a baby that other people keep.</summary>
    public const string AnonymousName = "Former member";

    private readonly ICurrentUser _currentUser;
    private readonly IAccountDataEraser _eraser;
    private readonly OwnDatabaseWiper _ownDatabase;
    private readonly IStoreHealth _storeHealth;
    private readonly IIdentityAccountRemover _identity;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<AccountDeletionService> _logger;

    public AccountDeletionService(
        ICurrentUser currentUser,
        IAccountDataEraser eraser,
        OwnDatabaseWiper ownDatabase,
        IStoreHealth storeHealth,
        IIdentityAccountRemover identity,
        TimeProvider timeProvider,
        ILogger<AccountDeletionService> logger)
    {
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _eraser = eraser ?? throw new ArgumentNullException(nameof(eraser));
        _ownDatabase = ownDatabase ?? throw new ArgumentNullException(nameof(ownDatabase));
        _storeHealth = storeHealth ?? throw new ArgumentNullException(nameof(storeHealth));
        _identity = identity ?? throw new ArgumentNullException(nameof(identity));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<AccountDeletionPreviewResponse> PreviewAsync(CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var plan = await _eraser.PlanAsync(user.Id, cancellationToken);
        var own = await _eraser.FindOwnStoreCopiesAsync(user.Id, plan.DeletedIds, _timeProvider.GetUtcNow(), cancellationToken);
        return AccountDeletionPreviewResponse.For(plan, user.Issuer.Length > 0 && _identity.CanRemove(user.Issuer), own.BabyIds);
    }

    public async Task<AccountDeletionResponse> DeleteAsync(AccountDeletionRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var issuer = user.Issuer;
        var subject = user.Subject;
        var now = _timeProvider.GetUtcNow();
        var plan = await _eraser.PlanAsync(user.Id, cancellationToken);
        plan.EnsureNotBlocked();
        var own = await _eraser.FindOwnStoreCopiesAsync(user.Id, plan.DeletedIds, now, cancellationToken);
        own.EnsureNoMoveRunning();
        var wipe = request.WipeOwnDatabase ? await _ownDatabase.WipeAsync(own.Copies, cancellationToken) : OwnDatabaseWipeResult.NotRequested;
        await _eraser.EraseAsync(user.Id, AnonymousName, now, ExternalStoreErasure.LottiesSideOnly, cancellationToken);
        ForgetStores(own.StoreIds);
        var identity = issuer.Length > 0
            ? await _identity.RemoveAsync(issuer, subject, CancellationToken.None)
            : IdentityRemoval.NotConfigured;
        _logger.LogInformation("Account of user {UserId} deleted; sign-in account: {IdentityRemoval}", user.Id, identity);
        return new AccountDeletionResponse { Identity = identity, OwnDatabaseWiped = wipe.Wiped, OwnDatabaseNotWiped = wipe.NotWiped };
    }

    /// <summary>Her descriptors are gone: the process drops their pools, breakers and ready flags (task T8's rule for a removed descriptor).</summary>
    private void ForgetStores(IReadOnlyList<Guid> storeIds)
    {
        foreach (var storeId in storeIds)
        {
            _storeHealth.Forget(storeId);
        }
    }
}
