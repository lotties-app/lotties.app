using System.Net;
using System.Net.Http.Json;
using BabyRoutine.Api.Tests.Support;
using BabyRoutine.Application.Babies;
using BabyRoutine.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Api.Tests.Endpoints;

public sealed class MemberEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static string MembersPath(Guid babyId) => $"/api/v1/babies/{babyId}/members";

    private static string MemberPath(Guid babyId, Guid userId) => $"{MembersPath(babyId)}/{userId}";

    private static string MePath(Guid babyId) => $"{MembersPath(babyId)}/me";

    private HttpClient As(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private Task<List<BabyMember>> StoredMembersAsync(Guid babyId) =>
        factory.QueryAsync(context => context.BabyMembers.Where(member => member.BabyId == babyId).ToListAsync());

    [Fact]
    public async Task List_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().GetAsync(MembersPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task List_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(MembersPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task List_Viewer_ReturnsMembersWithNamesAndRoles()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);

        var members = await (await As(baby, BabyRole.Viewer).GetAsync(MembersPath(baby.BabyId))).ReadAsync<List<MemberResponse>>();

        Assert.Equal(3, members.Count);
        Assert.Equal(
            new[] { ("Owner", BabyRole.Owner), ("Parent", BabyRole.Parent), ("Viewer", BabyRole.Viewer) }.Order(),
            members.Select(member => (member.DisplayName, member.Role)).Order());
    }

    [Fact]
    public async Task ChangeRole_Owner_UpdatesRole()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var viewerId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Viewer));

        var response = await As(baby, BabyRole.Owner).PatchAsJsonAsync(MemberPath(baby.BabyId, viewerId), new { role = "Parent" });

        var body = await response.ReadAsync<MemberResponse>();
        Assert.Equal((viewerId, BabyRole.Parent, "Viewer"), (body.UserId, body.Role, body.DisplayName));
        Assert.Equal(BabyRole.Parent, (await StoredMembersAsync(baby.BabyId)).Single(member => member.UserId == viewerId).Role);
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Viewer)]
    public async Task ChangeRole_NonOwner_Returns403(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);
        var viewerId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Viewer));

        var response = await As(baby, role).PatchAsJsonAsync(MemberPath(baby.BabyId, viewerId), new { role = "Owner" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(BabyRole.Viewer, (await StoredMembersAsync(baby.BabyId)).Single(member => member.UserId == viewerId).Role);
    }

    [Fact]
    public async Task ChangeRole_UnknownUser_Returns404()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).PatchAsJsonAsync(MemberPath(baby.BabyId, Guid.NewGuid()), new { role = "Parent" });

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "member_not_found");
    }

    [Fact]
    public async Task ChangeRole_DemoteLastOwner_Returns409()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);

        var response = await As(baby, BabyRole.Owner).PatchAsJsonAsync(MemberPath(baby.BabyId, ownerId), new { role = "Viewer" });

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "last_owner_required");
        Assert.Equal(BabyRole.Owner, (await StoredMembersAsync(baby.BabyId)).Single(member => member.UserId == ownerId).Role);
    }

    [Fact]
    public async Task ChangeRole_PromoteThenDemoteFormerOwner_Succeeds()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var parentId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Parent));
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);
        await As(baby, BabyRole.Owner).PatchAsJsonAsync(MemberPath(baby.BabyId, parentId), new { role = "Owner" });

        var response = await As(baby, BabyRole.Parent).PatchAsJsonAsync(MemberPath(baby.BabyId, ownerId), new { role = "Viewer" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("""{"role":"Admin"}""")]
    [InlineData("""{"role":7}""")]
    [InlineData("""{}""")]
    public async Task ChangeRole_InvalidRole_Returns400(string json)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var viewerId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Viewer));

        var response = await As(baby, BabyRole.Owner)
            .PatchAsync(MemberPath(baby.BabyId, viewerId), new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Remove_Owner_RemovesMember()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var viewerId = await factory.UserIdAsync(baby.SubjectOf(BabyRole.Viewer));

        var response = await As(baby, BabyRole.Owner).DeleteAsync(MemberPath(baby.BabyId, viewerId));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.DoesNotContain(await StoredMembersAsync(baby.BabyId), member => member.UserId == viewerId);
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Viewer)]
    public async Task Remove_NonOwnerRemovingSomeoneElse_Returns403(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);

        var response = await As(baby, role).DeleteAsync(MemberPath(baby.BabyId, ownerId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(3, (await StoredMembersAsync(baby.BabyId)).Count);
    }

    [Fact]
    public async Task Remove_LastOwner_Returns409()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var ownerId = await factory.UserIdAsync(baby.OwnerSubject);

        var response = await As(baby, BabyRole.Owner).DeleteAsync(MemberPath(baby.BabyId, ownerId));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "last_owner_required");
    }

    [Fact]
    public async Task Remove_UnknownUser_Returns404()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await As(baby, BabyRole.Owner).DeleteAsync(MemberPath(baby.BabyId, Guid.NewGuid()));

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "member_not_found");
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Viewer)]
    public async Task Leave_NonOwnerMember_RemovesSelf(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);
        var userId = await factory.UserIdAsync(baby.SubjectOf(role));

        var response = await As(baby, role).DeleteAsync(MePath(baby.BabyId));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.DoesNotContain(await StoredMembersAsync(baby.BabyId), member => member.UserId == userId);
    }

    [Fact]
    public async Task Leave_LastOwner_Returns409()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);

        var response = await As(baby, BabyRole.Owner).DeleteAsync(MePath(baby.BabyId));

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "last_owner_required");
    }

    [Fact]
    public async Task Leave_OwnerWhenAnotherOwnerExists_Succeeds()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Owner);

        var response = await As(baby, BabyRole.Owner).DeleteAsync(MePath(baby.BabyId));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Leave_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).DeleteAsync(MePath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
