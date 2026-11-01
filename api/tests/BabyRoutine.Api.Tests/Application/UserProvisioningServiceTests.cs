using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.Users;
using BabyRoutine.Domain.Users;
using Microsoft.Extensions.Logging.Abstractions;

namespace BabyRoutine.Api.Tests.Application;

public sealed class UserProvisioningServiceTests
{
    private const string Issuer = "https://issuer.example.test/";
    private const string OtherIssuer = "https://other.example.test/";

    private readonly FakeUserRepository _users = new();
    private readonly UserProvisioningService _service;

    public UserProvisioningServiceTests() =>
        _service = new UserProvisioningService(_users, new FixedTimeProvider(TestUsers.Now), NullLogger<UserProvisioningService>.Instance);

    [Fact]
    public async Task EnsureUserAsync_KnownIdentity_ReturnsExistingWithoutAdding()
    {
        var existing = User.Create(Issuer, "sub-1", "Ana", TestUsers.Now);
        _users.Seed(existing);

        var user = await _service.EnsureUserAsync(new ExternalIdentity(Issuer, "sub-1", "Other"));

        Assert.Same(existing, user);
        Assert.Equal(0, _users.AddCalls);
    }

    [Fact]
    public async Task EnsureUserAsync_NewIdentity_RegistersUserFromIdentityAtCurrentTime()
    {
        var user = await _service.EnsureUserAsync(new ExternalIdentity(Issuer, "sub-2", "Bia"));

        Assert.Equal((Issuer, "sub-2"), (user.Issuer, user.Subject));
        Assert.Equal("Bia", user.DisplayName);
        Assert.Equal(TestUsers.Now, user.CreatedAt);
        Assert.Equal(1, _users.AddCalls);
    }

    [Fact]
    public async Task EnsureUserAsync_SameSubjectFromAnotherIssuer_RegistersASeparateUser()
    {
        var existing = User.Create(Issuer, "sub-4", "Ana", TestUsers.Now);
        _users.Seed(existing);

        var user = await _service.EnsureUserAsync(new ExternalIdentity(OtherIssuer, "sub-4", "Eve"));

        Assert.NotEqual(existing.Id, user.Id);
        Assert.Equal(OtherIssuer, user.Issuer);
    }

    [Fact]
    public async Task EnsureUserAsync_UserFromBeforeIssuersWereStored_IsClaimedByTheFirstSignIn()
    {
        var legacy = User.Create(User.UnknownIssuer, "sub-5", "Ana", TestUsers.Now);
        _users.Seed(legacy);

        var user = await _service.EnsureUserAsync(new ExternalIdentity(Issuer, "sub-5", "Ana"));

        Assert.Same(legacy, user);
        Assert.Equal(Issuer, user.Issuer);
        Assert.Equal((0, 1), (_users.AddCalls, _users.SaveCalls));
    }

    [Fact]
    public async Task EnsureUserAsync_ClaimedUser_IsNotClaimedByAnotherIssuer()
    {
        var legacy = User.Create(User.UnknownIssuer, "sub-6", "Ana", TestUsers.Now);
        _users.Seed(legacy);
        await _service.EnsureUserAsync(new ExternalIdentity(Issuer, "sub-6", "Ana"));

        var other = await _service.EnsureUserAsync(new ExternalIdentity(OtherIssuer, "sub-6", "Eve"));

        Assert.NotEqual(legacy.Id, other.Id);
        Assert.Equal(Issuer, legacy.Issuer);
    }

    [Fact]
    public async Task EnsureUserAsync_ConcurrentInsertWon_ReturnsWinner()
    {
        var winner = User.Create(Issuer, "sub-3", "Winner", TestUsers.Now);
        _users.ConcurrentWinner = winner;

        var user = await _service.EnsureUserAsync(new ExternalIdentity(Issuer, "sub-3", "Loser"));

        Assert.Same(winner, user);
    }

    [Fact]
    public void Constructor_NullRepository_Throws()
    {
        Assert.Throws<ArgumentNullException>(
            () => new UserProvisioningService(null!, TimeProvider.System, NullLogger<UserProvisioningService>.Instance));
    }
}
