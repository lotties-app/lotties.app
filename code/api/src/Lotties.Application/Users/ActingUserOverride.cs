using Lotties.Domain.Users;

namespace Lotties.Application.Users;

/// <summary>
/// Scoped holder that makes <see cref="ICurrentUser"/> answer with a given user for the rest of the request. Only the demo start sets
/// it (an anonymous request that acts as the demo account it just created, so the sample data goes through the normal services).
/// </summary>
public sealed class ActingUserOverride
{
    public User? User { get; set; }
}
