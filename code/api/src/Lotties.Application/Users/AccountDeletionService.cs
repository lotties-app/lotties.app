using Lotties.Application.Stores;
using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Users;

/// <summary>
/// Account deletion (design 33 G1; for a family's own database, docs/design/47-bring-your-own-database.md section 9, task T10). The
/// recipe: plan and refuse a blocked deletion; block the erased babies' writes and moves (<c>BeginDeletionAsync</c>: refused while a
/// move of one runs or another deletion holds them); delete their records in her own database only when she asked for it
/// (<see cref="AccountDeletionRequest.WipeOwnDatabase"/>, opt-in), after the move drain so requests already running finish first;
/// erase Lotties' side in one transaction (her store descriptors included, in every case; the babies and their block go with it);
/// forget her stores' pools and breakers; then remove the sign-in account. A failure before the erasure lifts the block again. A store
/// that cannot be reached never blocks the erasure: its babies are reported as not wiped.
/// </summary>
internal sealed class AccountDeletionService : IAccountDeletionService
{
    /// <summary>Shown wherever the deleted user's name would appear on a baby that other people keep.</summary>
    public const string AnonymousName = "Former member";

    private readonly ICurrentUser _currentUser;
    private readonly IAccountDataEraser _eraser;
    private readonly OwnDatabaseWiper _ownDatabase;
    private readonly IStoreHealth _storeHealth;
    private readonly StoreMoveOptions _moveOptions;
    private readonly IIdentityAccountRemover _identity;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<AccountDeletionService> _logger;

    public AccountDeletionService(
        ICurrentUser currentUser,
        IAccountDataEraser eraser,
        OwnDatabaseWiper ownDatabase,
        IStoreHealth storeHealth,
        StoreMoveOptions moveOptions,
        IIdentityAccountRemover identity,
        TimeProvider timeProvider,
        ILogger<AccountDeletionService> logger)
    {
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _eraser = eraser ?? throw new ArgumentNullException(nameof(eraser));
        _ownDatabase = ownDatabase ?? throw new ArgumentNullException(nameof(ownDatabase));
        _storeHealth = storeHealth ?? throw new ArgumentNullException(nameof(storeHealth));
        _moveOptions = moveOptions ?? throw new ArgumentNullException(nameof(moveOptions));
        _identity = identity ?? throw new ArgumentNullException(nameof(identity));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<AccountDeletionPreviewResponse> PreviewAsync(CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var plan = await _eraser.PlanAsync(user.Id, cancellationToken);
        var own = await _eraser.FindOwnStoreCopiesAsync(user.Id, plan.DeletedIds, cancellationToken);
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
        await _eraser.BeginDeletionAsync(plan.DeletedIds, now, cancellationToken);
        var erased = await EraseOrLiftBlockAsync(user.Id, plan.DeletedIds, request, now, cancellationToken);
        ForgetStores(erased.StoreIds);
        var wipe = erased.Wipe;
        var identity = issuer.Length > 0
            ? await _identity.RemoveAsync(issuer, subject, CancellationToken.None)
            : IdentityRemoval.NotConfigured;
        _logger.LogInformation("Account of user {UserId} deleted; sign-in account: {IdentityRemoval}", user.Id, identity);
        return new AccountDeletionResponse { Identity = identity, OwnDatabaseWiped = wipe.Wiped, OwnDatabaseNotWiped = wipe.NotWiped };
    }

    /// <summary>
    /// The blocked part of the deletion: her own database (on request), then Lotties' side. Any failure before the erasure committed
    /// lifts the block, so the babies are not left refusing writes (a block that cannot be lifted expires by itself).
    /// </summary>
    private async Task<ErasedAccount> EraseOrLiftBlockAsync(Guid userId, IReadOnlyList<Guid> babyIds, AccountDeletionRequest request, DateTimeOffset now, CancellationToken cancellationToken)
    {
        try
        {
            var own = await _eraser.FindOwnStoreCopiesAsync(userId, babyIds, cancellationToken);
            var wipe = await WipeOwnDatabaseAsync(request, own, cancellationToken);
            await _eraser.EraseAsync(userId, AnonymousName, now, ExternalStoreErasure.LottiesSideOnly, cancellationToken);
            return new ErasedAccount(own.StoreIds, wipe);
        }
        catch
        {
            await LiftBlockAsync(babyIds);
            throw;
        }
    }

    /// <summary>Only when she asked for it and there is something there: after the move drain, so writes already running end first.</summary>
    private async Task<OwnDatabaseWipeResult> WipeOwnDatabaseAsync(AccountDeletionRequest request, OwnStoreCopies own, CancellationToken cancellationToken)
    {
        if (!request.WipeOwnDatabase || own.Copies.Count == 0)
        {
            return OwnDatabaseWipeResult.NotRequested;
        }

        await Task.Delay(_moveOptions.Drain, _timeProvider, cancellationToken);
        return await _ownDatabase.WipeAsync(own.Copies, cancellationToken);
    }

    private async Task LiftBlockAsync(IReadOnlyList<Guid> babyIds)
    {
        try
        {
            await _eraser.CancelDeletionAsync(babyIds, CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogWarning("Lifting the write block of a failed account deletion failed ({ExceptionType}); it expires by itself", exception.GetType().Name);
        }
    }

    /// <summary>Her descriptors are gone: the process drops their pools, breakers and ready flags (task T8's rule for a removed descriptor).</summary>
    private void ForgetStores(IReadOnlyList<Guid> storeIds)
    {
        foreach (var storeId in storeIds)
        {
            _storeHealth.Forget(storeId);
        }
    }

    private sealed record ErasedAccount(IReadOnlyList<Guid> StoreIds, OwnDatabaseWipeResult Wipe);
}
