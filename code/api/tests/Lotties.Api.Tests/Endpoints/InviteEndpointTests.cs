using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Babies;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

public sealed class InviteEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static string InvitesPath(Guid babyId) => $"/api/v1/babies/{babyId}/invites";

    private static string InvitePath(Guid babyId, Guid inviteId) => $"{InvitesPath(babyId)}/{inviteId}";

    private const string AcceptFromBodyPath = "/api/v1/invites/accept";

    private static string AcceptPath(string token) => $"/api/v1/invites/{token}/accept";

    private static Task<HttpResponseMessage> AcceptFromBodyAsync(HttpClient client, string? token) =>
        client.PostAsJsonAsync(AcceptFromBodyPath, new { token });

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private async Task<CreatedInviteResponse> CreateInviteAsync(SeededBaby baby, string role = "Parent", int? expiresInDays = null)
    {
        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(InvitesPath(baby.BabyId), new { role, expiresInDays });
        return await response.ReadAsync<CreatedInviteResponse>();
    }

    private Task<Invite> StoredInviteAsync(Guid inviteId) =>
        factory.QueryAsync(context => context.Invites.SingleAsync(invite => invite.Id == inviteId));

    [Fact]
    public async Task Create_Owner_Returns201WithTokenAndDefaultSevenDayExpiry()
    {
        var baby = await factory.SeedBabyAsync();
        var before = DateTimeOffset.UtcNow;

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(InvitesPath(baby.BabyId), new { role = "Viewer" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.ReadAsync<CreatedInviteResponse>();
        Assert.Equal((baby.BabyId, BabyRole.Viewer), (created.BabyId, created.Role));
        Assert.Matches("^[A-Za-z0-9_-]{43}$", created.Token);
        Assert.InRange(created.ExpiresAt - before, TimeSpan.FromDays(7) - TimeSpan.FromMinutes(1), TimeSpan.FromDays(7) + TimeSpan.FromMinutes(1));
    }

    [Fact]
    public async Task Create_StoresOnlyTheTokenHash()
    {
        var baby = await factory.SeedBabyAsync();

        var created = await CreateInviteAsync(baby);

        var stored = await StoredInviteAsync(created.Id);
        Assert.NotEqual(created.Token, stored.Token.Value);
        Assert.Equal(InviteToken.From(created.Token).Hash(), stored.Token);
    }

    [Fact]
    public async Task Create_CustomExpiry_IsApplied()
    {
        var baby = await factory.SeedBabyAsync();

        var created = await CreateInviteAsync(baby, expiresInDays: 2);

        Assert.InRange(created.ExpiresAt - created.CreatedAt, TimeSpan.FromDays(2), TimeSpan.FromDays(2));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-3)]
    [InlineData(31)]
    public async Task Create_ExpiryOutOfRange_Returns400(int days)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PostAsJsonAsync(InvitesPath(baby.BabyId), new { role = "Parent", expiresInDays = days });

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Create_TwoInvites_HaveDifferentTokens()
    {
        var baby = await factory.SeedBabyAsync();

        var first = await CreateInviteAsync(baby);
        var second = await CreateInviteAsync(baby);

        Assert.NotEqual(first.Token, second.Token);
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Viewer)]
    public async Task Create_NonOwner_Returns403(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);

        var response = await As(baby, role).PostAsJsonAsync(InvitesPath(baby.BabyId), new { role = "Owner" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Create_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().PostAsJsonAsync(InvitesPath(baby.BabyId), new { role = "Parent" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task List_Owner_ReturnsPendingInvitesWithoutTokens()
    {
        var baby = await factory.SeedBabyAsync();
        var pending = await CreateInviteAsync(baby);
        var accepted = await CreateInviteAsync(baby);
        await factory.CreateClientFor(TestUsers.NewSubject()).PostAsync(AcceptPath(accepted.Token), null);
        await factory.SeedAsync(async context =>
        {
            var expired = Invite.Issue(baby.BabyId, BabyRole.Viewer, await factory.UserIdAsync(baby.OwnerSubject), DateTimeOffset.UtcNow.AddDays(-10), TimeSpan.FromDays(1)).Invite;
            context.Invites.Add(expired);
        });

        var response = await As(baby, BabyRole.Owner).GetAsync(InvitesPath(baby.BabyId));

        var json = await response.Content.ReadAsStringAsync();
        var items = JsonSerializer.Deserialize<List<InviteResponse>>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal(pending.Id, Assert.Single(items).Id);
        Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Viewer)]
    public async Task List_NonOwner_Returns403(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);

        var response = await As(baby, role).GetAsync(InvitesPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Revoke_Owner_DeletesInviteAndTokenStopsWorking()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby);

        var response = await As(baby, BabyRole.Owner).DeleteAsync(InvitePath(baby.BabyId, created.Id));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var accept = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsync(AcceptPath(created.Token), null);
        await accept.AssertProblemAsync(HttpStatusCode.NotFound, "invite_not_found");
    }

    [Fact]
    public async Task Revoke_UnknownInvite_Returns204()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).DeleteAsync(InvitePath(baby.BabyId, Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Revoke_InviteOfAnotherBaby_LeavesItAlone()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var foreign = await CreateInviteAsync(other);

        var response = await As(mine, BabyRole.Owner).DeleteAsync(InvitePath(mine.BabyId, foreign.Id));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.NotNull(await StoredInviteAsync(foreign.Id));
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Viewer)]
    public async Task Revoke_NonOwner_Returns403(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);
        var created = await CreateInviteAsync(baby);

        var response = await As(baby, role).DeleteAsync(InvitePath(baby.BabyId, created.Id));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.NotNull(await StoredInviteAsync(created.Id));
    }

    [Theory]
    [InlineData("Viewer")]
    [InlineData("Parent")]
    [InlineData("Owner")]
    public async Task Accept_ValidToken_JoinsBabyWithInviteRole(string role)
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby, role);
        var subject = TestUsers.NewSubject();

        var response = await factory.CreateClientFor(subject, name: "Guest").PostAsync(AcceptPath(created.Token), null);

        var joined = await response.ReadAsync<BabyResponse>();
        var expectedRole = Enum.Parse<BabyRole>(role);
        Assert.Equal((baby.BabyId, expectedRole), (joined.Id, joined.Role));
        var userId = await factory.UserIdAsync(subject);
        var stored = await StoredInviteAsync(created.Id);
        Assert.Equal((userId, true), (stored.AcceptedBy, stored.IsAccepted));
        var members = await factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == baby.BabyId).ToListAsync());
        Assert.Equal(expectedRole, members.Single(member => member.UserId == userId).Role);
    }

    [Fact]
    public async Task Accept_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby);

        var response = await factory.CreateClient().PostAsync(AcceptPath(created.Token), null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Accept_UsedTokenByAnotherUser_Returns409AlreadyAccepted()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby);
        await factory.CreateClientFor(TestUsers.NewSubject()).PostAsync(AcceptPath(created.Token), null);

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsync(AcceptPath(created.Token), null);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "invite_already_accepted");
    }

    [Fact]
    public async Task Accept_ExpiredToken_Returns410AndAddsNoMember()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var issued = Invite.Issue(baby.BabyId, BabyRole.Parent, ownerId, DateTimeOffset.UtcNow.AddDays(-10), TimeSpan.FromDays(1));
        await factory.SeedAsync(context =>
        {
            context.Invites.Add(issued.Invite);
            return Task.CompletedTask;
        });
        var subject = TestUsers.NewSubject();

        var response = await factory.CreateClientFor(subject).PostAsync(AcceptPath(issued.Token.Value), null);

        await response.AssertProblemAsync(HttpStatusCode.Gone, "invite_expired");
        var members = await factory.QueryAsync(context => context.BabyMembers.CountAsync(member => member.BabyId == baby.BabyId));
        Assert.Equal(1, members);
    }

    [Fact]
    public async Task Accept_AlreadyMember_Returns409AndKeepsInviteUsable()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var created = await CreateInviteAsync(baby);

        var response = await As(baby, BabyRole.Viewer).PostAsync(AcceptPath(created.Token), null);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "member_already_exists");
        Assert.False((await StoredInviteAsync(created.Id)).IsAccepted);
    }

    [Theory]
    [InlineData("nope")]
    [InlineData("0123456789abcdef0123456789abcdef0123456789a")]
    public async Task Accept_UnknownOrMalformedToken_Returns404(string token)
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsync(AcceptPath(token), null);

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "invite_not_found");
    }

    [Fact]
    public async Task Accept_PassingTheStoredHashAsToken_DoesNotWork()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby);
        var storedHash = (await StoredInviteAsync(created.Id)).Token.Value;

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsync(AcceptPath(storedHash), null);

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "invite_not_found");
    }

    [Fact]
    public async Task AcceptFromBody_ValidToken_JoinsBabyWithInviteRole()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby, "Viewer");
        var subject = TestUsers.NewSubject();

        var response = await AcceptFromBodyAsync(factory.CreateClientFor(subject), created.Token);

        var joined = await response.ReadAsync<BabyResponse>();
        Assert.Equal((baby.BabyId, BabyRole.Viewer), (joined.Id, joined.Role));
        Assert.Equal(await factory.UserIdAsync(subject), (await StoredInviteAsync(created.Id)).AcceptedBy);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("nope")]
    [InlineData("0123456789abcdef0123456789abcdef0123456789a")]
    public async Task AcceptFromBody_MissingUnknownOrMalformedToken_Returns404(string? token)
    {
        var response = await AcceptFromBodyAsync(factory.CreateClientFor(TestUsers.NewSubject()), token);

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "invite_not_found");
    }

    [Fact]
    public async Task AcceptFromBody_UsedToken_Returns409AlreadyAccepted()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby);
        await AcceptFromBodyAsync(factory.CreateClientFor(TestUsers.NewSubject()), created.Token);

        var response = await AcceptFromBodyAsync(factory.CreateClientFor(TestUsers.NewSubject()), created.Token);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "invite_already_accepted");
    }

    [Fact]
    public async Task AcceptFromBody_ExpiredToken_Returns410()
    {
        var baby = await factory.SeedBabyAsync();
        var issued = Invite.Issue(baby.BabyId, BabyRole.Parent, await factory.UserIdAsync(baby.OwnerSubject), DateTimeOffset.UtcNow.AddDays(-10), TimeSpan.FromDays(1));
        await factory.SeedAsync(context =>
        {
            context.Invites.Add(issued.Invite);
            return Task.CompletedTask;
        });

        var response = await AcceptFromBodyAsync(factory.CreateClientFor(TestUsers.NewSubject()), issued.Token.Value);

        await response.AssertProblemAsync(HttpStatusCode.Gone, "invite_expired");
    }

    [Fact]
    public async Task AcceptFromBody_Anonymous_Returns401()
    {
        var response = await AcceptFromBodyAsync(factory.CreateClient(), "nope");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Accept_InviteAcceptedConcurrentlyByAnotherUser_Returns409AlreadyAcceptedAndAddsNoMember()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        var loser = TestUsers.NewSubject();
        await factory.CreateClientFor(loser).GetAsync("/api/v1/me");
        var client = factory.CreateClientLosingRaceTo(loser, async context =>
        {
            var invite = await context.InviteAsync(created.Id);
            invite.Accept(ownerId, DateTimeOffset.UtcNow);
            context.BumpRowVersion(invite);
        });

        var response = await AcceptFromBodyAsync(client, created.Token);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "invite_already_accepted");
        var loserId = await factory.UserIdAsync(loser);
        Assert.False(await factory.QueryAsync(context => context.BabyMembers.AnyAsync(member => member.BabyId == baby.BabyId && member.UserId == loserId)));
        Assert.Equal(ownerId, (await StoredInviteAsync(created.Id)).AcceptedBy);
    }

    [Fact]
    public async Task Accept_InviteRevokedConcurrently_Returns404()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby);
        var client = factory.CreateClientLosingRaceTo(TestUsers.NewSubject(), async context => context.Invites.Remove(await context.InviteAsync(created.Id)));

        var response = await AcceptFromBodyAsync(client, created.Token);

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "invite_not_found");
    }

    [Fact]
    public async Task Accept_BabyMembersChangedConcurrently_Returns409ConcurrentModificationWithRetryHint()
    {
        var baby = await factory.SeedBabyAsync();
        var created = await CreateInviteAsync(baby);
        var client = factory.CreateClientLosingRaceTo(TestUsers.NewSubject(), async context => context.BumpRowVersion(await context.BabyAsync(baby.BabyId)));

        var response = await AcceptFromBodyAsync(client, created.Token);

        var problem = await response.AssertProblemAsync(HttpStatusCode.Conflict, "concurrent_modification");
        Assert.True(problem.GetProperty("retryable").GetBoolean());
        Assert.False((await StoredInviteAsync(created.Id)).IsAccepted);
    }
}
