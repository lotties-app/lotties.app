using BabyRoutine.Application.Babies;
using BabyRoutine.Application.Users;
using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Users;

namespace BabyRoutine.Api.Tests.Support;

internal sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    public override DateTimeOffset GetUtcNow() => now;
}

internal sealed class FakeUserRepository : IUserRepository
{
    private readonly List<User> _users = [];

    /// <summary>When set, <see cref="AddOrGetExistingAsync"/> behaves as if this user won a concurrent insert.</summary>
    public User? ConcurrentWinner { get; set; }

    public int AddCalls { get; private set; }

    public int SaveCalls { get; private set; }

    public void Seed(User user) => _users.Add(user);

    public Task<User?> FindByIdentityAsync(string issuer, string subject, CancellationToken cancellationToken = default) =>
        Task.FromResult(_users.Find(user => user.Issuer == issuer && user.Subject == subject));

    public Task<IReadOnlyList<User>> FindByIdsAsync(IReadOnlyCollection<Guid> userIds, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<User>>(_users.Where(user => userIds.Contains(user.Id)).ToArray());

    public Task<User> AddOrGetExistingAsync(User user, CancellationToken cancellationToken = default)
    {
        AddCalls++;
        var stored = ConcurrentWinner ?? user;
        _users.Add(stored);
        return Task.FromResult(stored);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        SaveCalls++;
        return Task.CompletedTask;
    }
}

internal sealed class FakeCurrentUser(User user) : ICurrentUser
{
    public bool IsAuthenticated => true;

    public Task<User> GetUserAsync(CancellationToken cancellationToken = default) => Task.FromResult(user);
}

internal sealed class FakeMembershipRepository(params BabyMember[] members) : IBabyMembershipRepository
{
    public Task<BabyMember?> FindAsync(Guid babyId, Guid userId, CancellationToken cancellationToken = default) =>
        Task.FromResult(members.FirstOrDefault(member => member.BabyId == babyId && member.UserId == userId));
}

internal sealed class FakeBabyAccessService(BabyAccessDecision decision) : IBabyAccessService
{
    public List<(Guid BabyId, BabyRole RequiredRole)> Calls { get; } = [];

    public Task<BabyAccessDecision> CheckAsync(Guid babyId, BabyRole requiredRole, CancellationToken cancellationToken = default)
    {
        Calls.Add((babyId, requiredRole));
        return Task.FromResult(decision);
    }
}

internal sealed class FakeUserProvisioningService : IUserProvisioningService
{
    public List<ExternalIdentity> Calls { get; } = [];

    public Task<User> EnsureUserAsync(ExternalIdentity identity, CancellationToken cancellationToken = default)
    {
        Calls.Add(identity);
        return Task.FromResult(User.Register(identity, TestUsers.Now));
    }
}
