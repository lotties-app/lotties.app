using System.Net;
using System.Net.Http.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Babies;
using Lotties.Domain.Babies;
using Lotties.Domain.Users;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// A baby whose records are in the Owner's own database is Owner only in the first version (docs/design/47-bring-your-own-database.md
/// D11 and section 2.2, task T11; the privacy policy promises it, docs/design/33-privacy-audit.md section 17): no invite of any role
/// (family member or doctor) can be created for it, and an invite issued while it was hosted cannot be accepted once it moved
/// (<c>409 store_owner_only</c>, nobody joins). A hosted baby is shared as before.
/// </summary>
public sealed class StoreOwnerOnlyTests(StoreRoutingHost routing) : IClassFixture<StoreRoutingHost>
{
    private static readonly DateTimeOffset Now = TestUsers.Now;

    private ApiFactory Factory => routing.Factory;

    private WebApplicationFactory<Program> Host => routing.Host;

    [Theory]
    [InlineData("Parent")]
    [InlineData("Caregiver")]
    [InlineData("Viewer")]
    [InlineData("Owner")]
    [InlineData("Doctor")]
    public async Task CreateInvite_BabyOnTheOwnersOwnDatabase_Is409StoreOwnerOnlyAndIssuesNothing(string role)
    {
        var (owner, babyId) = await SeedOwnerAndBabyAsync();
        await MoveToOwnStoreAsync(owner, babyId);

        var response = await Host.ClientFor(owner.Subject).PostAsJsonAsync($"/api/v1/babies/{babyId}/invites", new { role });

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "store_owner_only");
        Assert.False(await Factory.QueryAsync(context => context.Invites.AnyAsync(invite => invite.BabyId == babyId)));
    }

    [Fact]
    public async Task AcceptInvite_IssuedBeforeTheBabyMovedToTheOwnersOwnDatabase_Is409StoreOwnerOnlyAndNobodyJoins()
    {
        var (owner, babyId) = await SeedOwnerAndBabyAsync();
        var created = await (await Host.ClientFor(owner.Subject).PostAsJsonAsync($"/api/v1/babies/{babyId}/invites", new { role = "Parent" })).ReadAsync<CreatedInviteResponse>();
        await MoveToOwnStoreAsync(owner, babyId);

        var response = await Host.ClientFor(TestUsers.NewSubject()).PostAsJsonAsync("/api/v1/invites/accept", new { token = created.Token });

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "store_owner_only");
        Assert.Equal([owner.Id], await MemberIdsAsync(babyId));
        Assert.False(await Factory.QueryAsync(context => context.Invites.Where(invite => invite.Id == created.Id).Select(invite => invite.AcceptedAt != null).SingleAsync()));
    }

    [Fact]
    public async Task Invite_HostedBaby_IsCreatedAndAcceptedAsBefore()
    {
        var (owner, babyId) = await SeedOwnerAndBabyAsync();
        var created = await (await Host.ClientFor(owner.Subject).PostAsJsonAsync($"/api/v1/babies/{babyId}/invites", new { role = "Caregiver" })).ReadAsync<CreatedInviteResponse>();

        var response = await Host.ClientFor(TestUsers.NewSubject()).PostAsJsonAsync("/api/v1/invites/accept", new { token = created.Token });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(2, (await MemberIdsAsync(babyId)).Length);
    }

    private async Task<(User Owner, Guid BabyId)> SeedOwnerAndBabyAsync()
    {
        var owner = User.Create(User.UnknownIssuer, TestUsers.NewSubject(), "Owner", Now);
        var baby = Baby.Create("Baby", DateOnly.FromDateTime(Now.UtcDateTime), owner.Id, Now);
        await Factory.SeedAsync(context =>
        {
            context.Users.Add(owner);
            context.Babies.Add(baby);
            return Task.CompletedTask;
        });
        return (owner, baby.Id);
    }

    private Task MoveToOwnStoreAsync(User owner, Guid babyId) => Factory.AssignStoreAsync(babyId, owner.Id, routing.Stores.Create());

    private Task<Guid[]> MemberIdsAsync(Guid babyId) =>
        Factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == babyId).Select(member => member.UserId).ToArrayAsync());
}
