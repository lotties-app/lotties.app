namespace BabyRoutine.Application.Babies;

/// <summary>Invite use cases. Managing a baby's invites needs an owner (checked by the caller); accepting needs only a signed-in user.</summary>
public interface IInviteService
{
    /// <summary>Default invite lifetime in days.</summary>
    public const int DefaultExpiresInDays = 7;

    /// <summary>Longest allowed invite lifetime in days.</summary>
    public const int MaxExpiresInDays = 30;

    /// <summary>Creates an invite and returns it with its plain token, which is not recoverable afterwards.</summary>
    Task<CreatedInviteResponse> CreateAsync(Guid babyId, CreateInviteRequest request, CancellationToken cancellationToken = default);

    /// <summary>Invites that are neither accepted nor expired; never includes tokens.</summary>
    Task<IReadOnlyList<InviteResponse>> ListPendingAsync(Guid babyId, CancellationToken cancellationToken = default);

    /// <summary>Deletes an invite of the baby so its token stops working. Unknown ids are a no-op.</summary>
    Task RevokeAsync(Guid babyId, Guid inviteId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds the current user to the invite's baby with the invite's role and returns that baby. Throws
    /// <see cref="Domain.Exceptions.InviteNotFoundException"/> (unknown or malformed token),
    /// <see cref="Domain.Exceptions.InviteExpiredException"/>, <see cref="Domain.Exceptions.InviteAlreadyAcceptedException"/>
    /// or <see cref="Domain.Exceptions.MemberAlreadyExistsException"/>.
    /// </summary>
    Task<BabyResponse> AcceptAsync(string token, CancellationToken cancellationToken = default);
}
