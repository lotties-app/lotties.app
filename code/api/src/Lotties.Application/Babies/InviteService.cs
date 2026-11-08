using Lotties.Application.Stores;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Professionals;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Babies;

/// <remarks>
/// A baby whose records are in a family's own database is Owner only in the first version (docs/design/47-bring-your-own-database.md
/// D11, task T11): no invite can be created for it and none (also one issued before it moved) can be accepted, whatever its role
/// (<c>409 store_owner_only</c>). The store pointer is read in the control plane (<see cref="IStoreResolver"/>); the family's database
/// is never opened for this decision.
/// </remarks>
internal sealed class InviteService : IInviteService
{
    private readonly IInviteRepository _invites;
    private readonly IBabyRepository _babies;
    private readonly IProfessionalProfileRepository _professionals;
    private readonly ICurrentUser _currentUser;
    private readonly IStoreResolver _stores;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<InviteService> _logger;

    public InviteService(
        IInviteRepository invites,
        IBabyRepository babies,
        IProfessionalProfileRepository professionals,
        ICurrentUser currentUser,
        IStoreResolver stores,
        TimeProvider timeProvider,
        ILogger<InviteService> logger)
    {
        _invites = invites ?? throw new ArgumentNullException(nameof(invites));
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
        _professionals = professionals ?? throw new ArgumentNullException(nameof(professionals));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _stores = stores ?? throw new ArgumentNullException(nameof(stores));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<CreatedInviteResponse> CreateAsync(Guid babyId, CreateInviteRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var lifetime = LifetimeOf(request);
        await EnsureAllowsOtherPeopleAsync(babyId, cancellationToken);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var issued = Invite.Issue(babyId, request.Role, user.Id, _timeProvider.GetUtcNow(), lifetime, ScopesOf(request));
        await _invites.AddAsync(issued.Invite, cancellationToken);
        _logger.LogInformation("User {UserId} invited as {Role} to baby {BabyId} (invite {InviteId})", user.Id, request.Role, babyId, issued.Invite.Id);
        return CreatedInviteResponse.For(issued);
    }

    public async Task<IReadOnlyList<InviteResponse>> ListPendingAsync(Guid babyId, CancellationToken cancellationToken = default)
    {
        var pending = await _invites.ListPendingAsync(babyId, _timeProvider.GetUtcNow(), cancellationToken);
        return pending.Select(invite => (InviteResponse)invite).ToArray();
    }

    public async Task RevokeAsync(Guid babyId, Guid inviteId, CancellationToken cancellationToken = default)
    {
        var invite = await _invites.FindForBabyAsync(babyId, inviteId, cancellationToken);
        if (invite is null)
        {
            _logger.LogDebug("Revoke of unknown invite {InviteId} for baby {BabyId} is a no-op", inviteId, babyId);
            return;
        }

        await _invites.RemoveAsync(invite, cancellationToken);
        _logger.LogInformation("Revoked invite {InviteId} of baby {BabyId}", inviteId, babyId);
    }

    public async Task<BabyResponse> AcceptAsync(string? token, CancellationToken cancellationToken = default)
    {
        var invite = await FindInviteAsync(token, cancellationToken);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var baby = await _babies.FindAsync(invite.BabyId, cancellationToken) ?? throw new InviteNotFoundException();
        await EnsureAllowsOtherPeopleAsync(baby.Id, cancellationToken);
        var isDeclaredProfessional = await IsDeclaredProfessionalAsync(invite.Role, user.Id, cancellationToken);
        var member = baby.AdmitWith(invite, user.Id, _timeProvider.GetUtcNow(), isDeclaredProfessional);
        await _babies.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("User {UserId} joined baby {BabyId} as {Role} with invite {InviteId}", user.Id, baby.Id, member.Role, invite.Id);
        return BabyResponse.For(baby, member);
    }

    private async Task EnsureAllowsOtherPeopleAsync(Guid babyId, CancellationToken cancellationToken) =>
        (await _stores.ResolveForBabyAsync(babyId, cancellationToken)).EnsureAllowsOtherPeople(babyId);

    private async Task<bool> IsDeclaredProfessionalAsync(BabyRole role, Guid userId, CancellationToken cancellationToken) =>
        role.RequiresProfessionalProfile() && await _professionals.FindAsync(userId, cancellationToken) is not null;

    private async Task<Invite> FindInviteAsync(string? token, CancellationToken cancellationToken)
    {
        if (!InviteToken.TryFrom(token, out var plainToken))
        {
            throw new InviteNotFoundException();
        }

        return await _invites.FindByHashedTokenAsync(plainToken.Hash(), cancellationToken) ?? throw new InviteNotFoundException();
    }

    /// <summary>The scopes a request names, or <c>null</c> (the defaults) when it names none.</summary>
    private static DoctorScopeSet? ScopesOf(CreateInviteRequest request) =>
        request.DoctorScopes is null ? null : DoctorScopeSet.Parse(request.DoctorScopes);

    private static TimeSpan LifetimeOf(CreateInviteRequest request)
    {
        var days = request.ExpiresInDays ?? IInviteService.DefaultExpiresInDays;
        return days is >= 1 and <= IInviteService.MaxExpiresInDays
            ? TimeSpan.FromDays(days)
            : throw new DomainValidationException(nameof(request.ExpiresInDays), $"Expiry must be between 1 and {IInviteService.MaxExpiresInDays} days.");
    }
}
