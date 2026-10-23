using System.Net;
using System.Net.Http.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

public sealed class AccountDeletionEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string MePath = "/api/v1/me";
    private const string PreviewPath = "/api/v1/me/deletion-preview";

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private static string EventPath(Guid babyId, Guid eventId) => $"/api/v1/babies/{babyId}/events/{eventId}";

    private static object EventBody() => new
    {
        typeId = BuiltInEventTypes.FeedingId,
        startedAt = TestUsers.Now,
        payload = new { method = "bottle", amount = 120 },
        notes = "feed",
    };

    private async Task<Guid> LogEventAsync(SeededBaby baby, BabyRole role)
    {
        var eventId = Guid.NewGuid();
        (await As(baby, role).PutAsJsonAsync(EventPath(baby.BabyId, eventId), EventBody())).EnsureSuccessStatusCode();
        return eventId;
    }

    [Fact]
    public async Task Delete_Anonymous_Returns401()
    {
        var response = await factory.CreateClient().DeleteAsync(MePath);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Delete_OnlyMemberOfABaby_ErasesTheBabyAndAnonymizesTheUser()
    {
        var baby = await factory.SeedBabyAsync();
        var client = As(baby, BabyRole.Owner);
        var kept = await LogEventAsync(baby, BabyRole.Owner);
        var softDeleted = await LogEventAsync(baby, BabyRole.Owner);
        (await client.DeleteAsync(EventPath(baby.BabyId, softDeleted))).EnsureSuccessStatusCode();
        var userId = await factory.UserIdAsync(baby.OwnerSubject);

        var body = await (await client.DeleteAsync(MePath)).ReadAsync<AccountDeletionResponse>();

        Assert.False(body.IdentityRemoved);
        Assert.Empty(await factory.QueryAsync(context => context.Babies.Where(item => item.Id == baby.BabyId).ToListAsync()));
        Assert.Empty(await factory.QueryAsync(context => context.Events.IgnoreQueryFilters().Where(item => item.Id == kept || item.Id == softDeleted).ToListAsync()));
        Assert.Empty(await factory.QueryAsync(context => context.BabyMembers.Where(member => member.UserId == userId).ToListAsync()));
        var user = await factory.QueryAsync(context => context.Users.SingleAsync(item => item.Id == userId));
        Assert.Equal((User.DeletedIssuer, "Former member", true), (user.Issuer, user.DisplayName, user.IsDeleted));
        Assert.NotEqual(baby.OwnerSubject, user.Subject);
    }

    [Fact]
    public async Task Delete_ThenSignInAgainWithTheSameIdentity_StartsWithANewEmptyUser()
    {
        var baby = await factory.SeedBabyAsync();
        var oldId = await factory.UserIdAsync(baby.OwnerSubject);
        (await As(baby, BabyRole.Owner).DeleteAsync(MePath)).EnsureSuccessStatusCode();

        var fresh = await factory.CreateClientFor(baby.OwnerSubject, name: "Ana").GetFromJsonAsync<CurrentUserResponse>(MePath);

        Assert.NotEqual(oldId, fresh!.Id);
        Assert.Empty(await As(baby, BabyRole.Owner).GetFromJsonAsync<List<BabyResponseStub>>("/api/v1/babies") ?? []);
    }

    [Fact]
    public async Task Delete_ParentOfASharedBaby_LeavesTheBabyAndItsRecordsToTheOthers()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var eventId = await LogEventAsync(baby, BabyRole.Parent);
        var parentId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Parent));

        (await As(baby, BabyRole.Parent).DeleteAsync(MePath)).EnsureSuccessStatusCode();

        Assert.Single(await factory.QueryAsync(context => context.Babies.Where(item => item.Id == baby.BabyId).ToListAsync()));
        var stored = await factory.QueryAsync(context => context.Events.SingleAsync(item => item.Id == eventId));
        Assert.Equal(parentId, stored.CreatedBy);
        var members = await factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == baby.BabyId).ToListAsync());
        Assert.Equal([BabyRole.Owner], members.Select(member => member.Role));
        Assert.Equal("Former member", (await factory.QueryAsync(context => context.Users.SingleAsync(item => item.Id == parentId))).DisplayName);
    }

    [Fact]
    public async Task Delete_OnlyOwnerOfASharedBaby_Returns409AndChangesNothing()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);

        var response = await As(baby, BabyRole.Owner).DeleteAsync(MePath);

        var problem = await response.AssertProblemAsync(HttpStatusCode.Conflict, "account_deletion_blocked");
        Assert.Equal(baby.BabyId, problem.GetProperty("babyIds")[0].GetGuid());
        Assert.Equal(2, (await factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == baby.BabyId).ToListAsync())).Count);
        Assert.False((await factory.QueryAsync(context => context.Users.SingleAsync(item => item.Subject == baby.OwnerSubject))).IsDeleted);
    }

    [Fact]
    public async Task Delete_OneOfTwoOwners_IsAllowed()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Owner);

        var response = await As(baby, BabyRole.Owner).DeleteAsync(MePath);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Single(await factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == baby.BabyId).ToListAsync()));
    }

    [Fact]
    public async Task Preview_ListsErasedSharedAndBlockedBabies()
    {
        var me = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Me", TestUsers.Now);
        var other = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Other", TestUsers.Now);
        var alone = Baby.Create("Alone", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), me.Id, TestUsers.Now);
        var shared = Baby.Create("Shared", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), other.Id, TestUsers.Now);
        shared.AddMember(me.Id, BabyRole.Parent, TestUsers.Now);
        var blocked = Baby.Create("Blocked", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), me.Id, TestUsers.Now);
        blocked.AddMember(other.Id, BabyRole.Viewer, TestUsers.Now);
        await factory.SeedAsync(context =>
        {
            context.Users.AddRange(me, other);
            context.Babies.AddRange(alone, shared, blocked);
            return Task.CompletedTask;
        });

        var preview = await factory.CreateClientFor(me.Subject).GetFromJsonAsync<AccountDeletionPreviewResponse>(PreviewPath);

        Assert.Equal([alone.Id], preview!.DeletedBabies.Select(item => item.Id));
        Assert.Equal([shared.Id], preview.SharedBabies.Select(item => item.Id));
        Assert.Equal([blocked.Id], preview.BlockedBabies.Select(item => item.Id));
        Assert.False(preview.CanDelete);
    }

    private sealed record BabyResponseStub(Guid Id);
}
