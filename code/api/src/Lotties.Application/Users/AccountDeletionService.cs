using Lotties.Domain.Users;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Users;

internal sealed class AccountDeletionService : IAccountDeletionService
{
    /// <summary>Shown wherever the deleted user's name would appear on a baby that other people keep.</summary>
    public const string AnonymousName = "Former member";

    private readonly ICurrentUser _currentUser;
    private readonly IAccountDataEraser _eraser;
    private readonly IIdentityAccountRemover _identity;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<AccountDeletionService> _logger;

    public AccountDeletionService(
        ICurrentUser currentUser,
        IAccountDataEraser eraser,
        IIdentityAccountRemover identity,
        TimeProvider timeProvider,
        ILogger<AccountDeletionService> logger)
    {
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _eraser = eraser ?? throw new ArgumentNullException(nameof(eraser));
        _identity = identity ?? throw new ArgumentNullException(nameof(identity));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<AccountDeletionPreviewResponse> PreviewAsync(CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var plan = await _eraser.PlanAsync(user.Id, cancellationToken);
        return AccountDeletionPreviewResponse.For(plan, user.Issuer.Length > 0 && _identity.CanRemove(user.Issuer));
    }

    public async Task<AccountDeletionResponse> DeleteAsync(CancellationToken cancellationToken = default)
    {
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var issuer = user.Issuer;
        var subject = user.Subject;
        await _eraser.EraseAsync(user.Id, AnonymousName, _timeProvider.GetUtcNow(), cancellationToken);
        var identity = issuer.Length > 0
            ? await _identity.RemoveAsync(issuer, subject, CancellationToken.None)
            : IdentityRemoval.NotConfigured;
        _logger.LogInformation("Account of user {UserId} deleted; sign-in account: {IdentityRemoval}", user.Id, identity);
        return new AccountDeletionResponse { Identity = identity };
    }
}
