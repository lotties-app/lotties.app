using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.Babies;

public sealed class InviteTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly Guid CreatorId = Guid.NewGuid();
    private static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);

    [Fact]
    public void Create_Valid_SetsExpiryAndToken()
    {
        var invite = Invite.Create(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime);

        Assert.Equal(TestClock.Now + Lifetime, invite.ExpiresAt);
        Assert.Equal(BabyRole.Viewer, invite.Role);
        Assert.False(string.IsNullOrEmpty(invite.Token.Value));
        Assert.False(invite.IsAccepted);
    }

    [Fact]
    public void Create_TwoInvites_HaveDifferentTokens()
    {
        var first = Invite.Create(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime);
        var second = Invite.Create(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime);

        Assert.NotEqual(first.Token, second.Token);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Create_NonPositiveLifetime_ThrowsValidation(int minutes)
    {
        Assert.Throws<DomainValidationException>(
            () => Invite.Create(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, TimeSpan.FromMinutes(minutes)));
    }

    [Fact]
    public void Create_EmptyBaby_ThrowsArgument()
    {
        Assert.Throws<ArgumentException>(() => Invite.Create(Guid.Empty, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime));
    }

    [Fact]
    public void IsExpired_BeforeExpiry_ReturnsFalse()
    {
        var invite = Invite.Create(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime);

        Assert.False(invite.IsExpired(invite.ExpiresAt.AddTicks(-10)));
    }

    [Fact]
    public void IsExpired_AtExpiry_ReturnsTrue()
    {
        var invite = Invite.Create(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime);

        Assert.True(invite.IsExpired(invite.ExpiresAt));
    }

    [Fact]
    public void Accept_Valid_RecordsAcceptance()
    {
        var invite = Invite.Create(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime);
        var userId = Guid.NewGuid();

        invite.Accept(userId, TestClock.Now.AddDays(1));

        Assert.True(invite.IsAccepted);
        Assert.Equal(userId, invite.AcceptedBy);
        Assert.Equal(TestClock.Now.AddDays(1), invite.AcceptedAt);
    }

    [Fact]
    public void Accept_Twice_ThrowsAlreadyAccepted()
    {
        var invite = Invite.Create(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime);
        invite.Accept(Guid.NewGuid(), TestClock.Now);

        Assert.Throws<InviteAlreadyAcceptedException>(() => invite.Accept(Guid.NewGuid(), TestClock.Now));
    }

    [Fact]
    public void Accept_Expired_ThrowsExpiredAndStaysUnaccepted()
    {
        var invite = Invite.Create(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime);

        Assert.Throws<InviteExpiredException>(() => invite.Accept(Guid.NewGuid(), TestClock.Now + Lifetime));
        Assert.False(invite.IsAccepted);
    }
}
