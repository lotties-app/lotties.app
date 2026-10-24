using Lotties.Application.Board;
using Lotties.Application.Users;
using Lotties.Domain.Board;

namespace Lotties.Api.Board;

/// <summary>
/// The board caller of the current request, read from the principal the authentication and the board guard left
/// (<see cref="BoardClaims.AccessOf"/>). A user's actor is her <c>users</c> row (created on first use, like any signed-in
/// call); a key's actor is the key.
/// </summary>
internal sealed class HttpBoardCaller(IHttpContextAccessor httpContextAccessor, ICurrentUser currentUser) : IBoardCaller
{
    private BoardAccess? _access;

    public BoardAccess Access => _access ??= BoardClaims.AccessOf(httpContextAccessor.HttpContext?.User);

    public async Task<BoardActor> GetActorAsync(CancellationToken cancellationToken = default)
    {
        if (Access is { Kind: BoardActorKind.ApiKey, KeyId: { } keyId })
        {
            return BoardActor.ForKey(keyId, Access.Name);
        }

        var user = await currentUser.GetUserAsync(cancellationToken);
        return BoardActor.ForUser(user.Id, user.DisplayName);
    }
}
