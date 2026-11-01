using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Babies;

public sealed class InviteTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly Guid CreatorId = Guid.NewGuid();
    private static readonly TimeSpan Lifetime = TimeSpan.FromDays(7);

    [Fact]
    public void Issue_Valid_SetsExpiryAndToken()
    {
        var invite = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;

        Assert.Equal(TestClock.Now + Lifetime, invite.ExpiresAt);
        Assert.Equal(BabyRole.Viewer, invite.Role);
        Assert.False(string.IsNullOrEmpty(invite.Token.Value));
        Assert.False(invite.IsAccepted);
    }

    [Fact]
    public void Issue_Valid_StoresOnlyTheTokenHash()
    {
        var issued = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime);

        Assert.NotEqual(issued.Token, issued.Invite.Token);
        Assert.Equal(issued.Token.Hash(), issued.Invite.Token);
    }

    [Fact]
    public void IsPendingAt_PendingInvite_ReturnsTrueUntilExpiry()
    {
        var invite = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;

        Assert.True(invite.IsPendingAt(TestClock.Now));
        Assert.False(invite.IsPendingAt(invite.ExpiresAt));
    }

    [Fact]
    public void IsPendingAt_AcceptedInvite_ReturnsFalse()
    {
        var invite = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;
        invite.Accept(Guid.NewGuid(), TestClock.Now);

        Assert.False(invite.IsPendingAt(TestClock.Now));
    }

    [Fact]
    public void Issue_TwoInvites_HaveDifferentTokens()
    {
        var first = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;
        var second = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;

        Assert.NotEqual(first.Token, second.Token);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Issue_NonPositiveLifetime_ThrowsValidation(int minutes)
    {
        Assert.Throws<DomainValidationException>(
            () => Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, TimeSpan.FromMinutes(minutes)));
    }

    [Fact]
    public void Issue_EmptyBaby_ThrowsArgument()
    {
        Assert.Throws<ArgumentException>(() => Invite.Issue(Guid.Empty, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime));
    }

    [Fact]
    public void IsExpired_BeforeExpiry_ReturnsFalse()
    {
        var invite = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;

        Assert.False(invite.IsExpired(invite.ExpiresAt.AddTicks(-10)));
    }

    [Fact]
    public void IsExpired_AtExpiry_ReturnsTrue()
    {
        var invite = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;

        Assert.True(invite.IsExpired(invite.ExpiresAt));
    }

    [Fact]
    public void Accept_Valid_RecordsAcceptance()
    {
        var invite = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;
        var userId = Guid.NewGuid();

        invite.Accept(userId, TestClock.Now.AddDays(1));

        Assert.True(invite.IsAccepted);
        Assert.Equal(userId, invite.AcceptedBy);
        Assert.Equal(TestClock.Now.AddDays(1), invite.AcceptedAt);
    }

    [Fact]
    public void Accept_Twice_ThrowsAlreadyAccepted()
    {
        var invite = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;
        invite.Accept(Guid.NewGuid(), TestClock.Now);

        Assert.Throws<InviteAlreadyAcceptedException>(() => invite.Accept(Guid.NewGuid(), TestClock.Now));
    }

    [Fact]
    public void Accept_Expired_ThrowsExpiredAndStaysUnaccepted()
    {
        var invite = Invite.Issue(BabyId, BabyRole.Viewer, CreatorId, TestClock.Now, Lifetime).Invite;

        Assert.Throws<InviteExpiredException>(() => invite.Accept(Guid.NewGuid(), TestClock.Now + Lifetime));
        Assert.False(invite.IsAccepted);
    }
}
