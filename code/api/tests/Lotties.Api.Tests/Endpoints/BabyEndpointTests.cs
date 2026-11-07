using System.Net;
using System.Net.Http.Json;
using Lotties.Api.Tests.Support;
using Lotties.Application.Babies;
using Lotties.Domain.Babies;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

public sealed class BabyEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string BabiesPath = "/api/v1/babies";

    private static string BabyPath(Guid babyId) => $"{BabiesPath}/{babyId}";

    [Fact]
    public async Task List_Anonymous_Returns401()
    {
        var response = await factory.CreateClient().GetAsync(BabiesPath);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Create_Valid_Returns201WithOwnerRoleAndPersistsOwnerMembership()
    {
        var subject = TestUsers.NewSubject();

        var response = await factory.CreateClientFor(subject).PostAsJsonAsync(BabiesPath, new { name = " Lia ", birthDate = "2026-01-02" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.ReadAsync<BabyResponse>();
        Assert.Equal(BabyPath(created.Id), response.Headers.Location?.OriginalString);
        Assert.Equal(("Lia", "baby", new DateOnly(2025, 12, 29), true, BabyRole.Owner), (created.Name, created.Label, created.BirthDate, created.BirthWeekOnly, created.Role));
        var userId = await factory.UserIdAsync(subject);
        var member = await factory.QueryAsync(context => context.BabyMembers.SingleAsync(stored => stored.BabyId == created.Id));
        Assert.Equal((userId, BabyRole.Owner), (member.UserId, member.Role));
    }

    [Fact]
    public async Task Create_RoleIsWrittenAsString()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsJsonAsync(BabiesPath, new { name = "Lia", birthDate = "2026-01-02" });

        var json = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"role\":\"Owner\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Create_BirthDateServerUtcTomorrow_Returns201()
    {
        var tomorrow = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1);

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsJsonAsync(BabiesPath, new { name = "Lia", birthDate = tomorrow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Create_BirthDateTwoDaysAhead_Returns400OnBirthDate()
    {
        var dayAfterTomorrow = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(2);

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsJsonAsync(BabiesPath, new { name = "Lia", birthDate = dayAfterTomorrow.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture) });

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("BirthDate", problem.GetProperty("field").GetString());
    }

    [Theory]
    [InlineData("""{"name":"Lia","birthDate":"2999-01-01"}""")]
    [InlineData("""{"name":"Lia"}""")]
    [InlineData("not json")]
    public async Task Create_Invalid_Returns400(string json)
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject())
            .PostAsync(BabiesPath, new StringContent(json, System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_WithoutNameOrLabel_IsAllowedAndTheLabelDefaultsToBaby()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsJsonAsync(BabiesPath, new { birthDate = "2026-01-02" });

        var created = await response.ReadAsync<BabyResponse>();
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal((string.Empty, "baby"), (created.Name, created.Label));
    }

    [Fact]
    public async Task Create_WithACustomLabel_KeepsItAndNoName()
    {
        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PostAsJsonAsync(BabiesPath, new { label = " Girl ", birthDate = "2026-01-02" });

        var created = await response.ReadAsync<BabyResponse>();
        Assert.Equal((string.Empty, "girl"), (created.Name, created.Label));
    }

    [Fact]
    public async Task Put_ExactDateStaysUntilTheWeekIsRequested()
    {
        var baby = await factory.SeedBabyAsync();
        var client = factory.CreateClientFor(baby.OwnerSubject);
        var stored = await factory.QueryAsync(context => context.Babies.SingleAsync(item => item.Id == baby.BabyId));
        var date = stored.BirthDate.ToString("yyyy-MM-dd");

        var same = await (await client.PutAsJsonAsync(BabyPath(baby.BabyId), new { name = "Lia", birthDate = date })).ReadAsync<BabyResponse>();
        var week = await (await client.PutAsJsonAsync(BabyPath(baby.BabyId), new { name = "Lia", birthDate = date, birthWeekOnly = true })).ReadAsync<BabyResponse>();

        Assert.Equal((stored.BirthDate, false), (same.BirthDate, same.BirthWeekOnly));
        Assert.Equal((Lotties.Domain.Babies.BirthWeek.MondayOf(stored.BirthDate), true), (week.BirthDate, week.BirthWeekOnly));
    }

    [Fact]
    public async Task List_ReturnsOnlyBabiesOfCurrentUserWithTheirRole()
    {
        var parentOf = await factory.SeedBabyAsync(BabyRole.Parent);
        var other = await factory.SeedBabyAsync();

        var babies = await (await factory.CreateClientFor(parentOf.SubjectOf(BabyRole.Parent)).GetAsync(BabiesPath)).ReadAsync<List<BabyResponse>>();

        var only = Assert.Single(babies);
        Assert.Equal((parentOf.BabyId, BabyRole.Parent), (only.Id, only.Role));
        Assert.DoesNotContain(babies, baby => baby.Id == other.BabyId);
    }

    [Fact]
    public async Task List_NewUser_ReturnsEmptyList()
    {
        var babies = await (await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(BabiesPath)).ReadAsync<List<BabyResponse>>();

        Assert.Empty(babies);
    }

    [Theory]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Owner)]
    public async Task Get_AnyMember_Returns200WithOwnRole(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);

        var response = await factory.CreateClientFor(baby.SubjectOf(role)).GetAsync(BabyPath(baby.BabyId));

        var body = await response.ReadAsync<BabyResponse>();
        Assert.Equal((baby.BabyId, "Lia", role), (body.Id, body.Name, body.Role));
    }

    [Fact]
    public async Task Get_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(BabyPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Get_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().GetAsync(BabyPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Put_Owner_RenamesAndChangesBirthDate()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync(BabyPath(baby.BabyId), new { name = "Lia Maria", birthDate = "2026-01-05" });

        var body = await response.ReadAsync<BabyResponse>();
        Assert.Equal(("Lia Maria", new DateOnly(2026, 1, 5)), (body.Name, body.BirthDate));
        var stored = await factory.QueryAsync(context => context.Babies.SingleAsync(item => item.Id == baby.BabyId));
        Assert.Equal("Lia Maria", stored.Name);
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Viewer)]
    public async Task Put_NonOwnerMember_Returns403AndKeepsBaby(BabyRole role)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent, BabyRole.Viewer);

        var response = await factory.CreateClientFor(baby.SubjectOf(role)).PutAsJsonAsync(BabyPath(baby.BabyId), new { name = "Hacked", birthDate = "2026-01-05" });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("Lia", (await factory.QueryAsync(context => context.Babies.SingleAsync(item => item.Id == baby.BabyId))).Name);
    }

    [Fact]
    public async Task Put_InvalidName_Returns400()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(baby.OwnerSubject).PutAsJsonAsync(BabyPath(baby.BabyId), new { name = new string('a', 101), birthDate = "2026-01-05" });

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Delete_Baby_IsNotSupported()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(baby.OwnerSubject).DeleteAsync(BabyPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }
}
