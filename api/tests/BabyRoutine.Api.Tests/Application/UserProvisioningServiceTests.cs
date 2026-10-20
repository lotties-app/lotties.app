using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.Users;
using BabyRoutine.Domain.Users;
using Microsoft.Extensions.Logging.Abstractions;

namespace BabyRoutine.Api.Tests.Application;

public sealed class UserProvisioningServiceTests
{
    private readonly FakeUserRepository _users = new();
    private readonly UserProvisioningService _service;

    public UserProvisioningServiceTests() =>
        _service = new UserProvisioningService(_users, new FixedTimeProvider(TestUsers.Now), NullLogger<UserProvisioningService>.Instance);

    [Fact]
    public async Task EnsureUserAsync_KnownSubject_ReturnsExistingWithoutAdding()
    {
        var existing = User.Create("sub-1", "Ana", TestUsers.Now);
        _users.Seed(existing);

        var user = await _service.EnsureUserAsync(new ExternalIdentity("sub-1", "Other", null));

        Assert.Same(existing, user);
        Assert.Equal(0, _users.AddCalls);
    }

    [Fact]
    public async Task EnsureUserAsync_NewSubject_RegistersUserFromIdentityAtCurrentTime()
    {
        var user = await _service.EnsureUserAsync(new ExternalIdentity("sub-2", "Bia", "bia@example.test"));

        Assert.Equal("sub-2", user.Subject);
        Assert.Equal("Bia", user.DisplayName);
        Assert.Equal(TestUsers.Now, user.CreatedAt);
        Assert.Equal(1, _users.AddCalls);
    }

    [Fact]
    public async Task EnsureUserAsync_ConcurrentInsertWon_ReturnsWinner()
    {
        var winner = User.Create("sub-3", "Winner", TestUsers.Now);
        _users.ConcurrentWinner = winner;

        var user = await _service.EnsureUserAsync(new ExternalIdentity("sub-3", "Loser", null));

        Assert.Same(winner, user);
    }

    [Fact]
    public void Constructor_NullRepository_Throws()
    {
        Assert.Throws<ArgumentNullException>(
            () => new UserProvisioningService(null!, TimeProvider.System, NullLogger<UserProvisioningService>.Instance));
    }
}
