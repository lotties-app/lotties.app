using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Board;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Board;

/// <summary>
/// Who may use the project board (docs/design/36-project-board.md section 4): Keycloak realm roles for users, hashed API
/// keys for machines, nothing for anyone else; the flag; key management by admins only; the secret shown once.
/// The route-by-caller table is <c>EndpointRoleMatrixTests.BoardMatrix</c>.
/// </summary>
public sealed class BoardAuthorizationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = BoardTestKit.Path;

    [Fact]
    public async Task Disabled_EveryRouteIs404ForEveryone_EvenWithAKeyOrAnAdminRole()
    {
        var secret = await factory.SeedKeyAsync(BoardKeyScope.Write);
        using var disabled = factory.WithWebHostBuilder(builder => builder.UseSetting("Board:Enabled", "false"));
        var admin = disabled.CreateClient();
        admin.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, TestUsers.NewSubject());
        admin.DefaultRequestHeaders.Add(TestAuthHandler.RealmRolesHeader, BoardTestKit.Admin);
        var key = disabled.CreateClient();
        key.DefaultRequestHeaders.Add("X-Board-Key", secret);

        var responses = new[]
        {
            await disabled.CreateClient().GetAsync($"{Path}/summary"),
            await admin.GetAsync($"{Path}/me"),
            await admin.GetAsync($"{Path}/keys"),
            await key.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item("x")),
            await key.GetAsync($"{Path}/items/{Guid.NewGuid()}"),
        };

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.NotFound, response.StatusCode));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("offline_access,uma_authorization,default-roles-lotties.app")]
    [InlineData("lotties-board-superuser,LOTTIES-BOARD-ADMIN")]
    public async Task UserWithoutABoardRole_IsAPlain403_WhetherTheItemExistsOrNot(string? roles)
    {
        var item = await factory.BoardUser(BoardTestKit.Writer).CreateAsync(BoardTestKit.Item("Exists"));
        var user = factory.BoardUser(roles);

        var existing = await user.GetAsync($"{Path}/items/{item.IdOf()}");
        var missing = await user.GetAsync($"{Path}/items/{Guid.NewGuid()}");
        var me = await user.GetAsync($"{Path}/me");

        Assert.Equal((HttpStatusCode.Forbidden, HttpStatusCode.Forbidden, HttpStatusCode.Forbidden), (existing.StatusCode, missing.StatusCode, me.StatusCode));
        Assert.Equal(await existing.Content.ReadAsStringAsync(), await missing.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Anonymous_Is401()
    {
        var response = await factory.CreateClient().GetAsync($"{Path}/summary");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [InlineData(BoardTestKit.Reader, true, false, false)]
    [InlineData(BoardTestKit.Writer, true, true, false)]
    [InlineData(BoardTestKit.Admin, true, true, true)]
    [InlineData("lotties-board-reader,lotties-board-admin", true, true, true)]
    public async Task Me_UserRoles_ImplyTheWeakerOnes(string roles, bool read, bool write, bool admin)
    {
        var me = await (await factory.BoardUser(roles, name: "Vinicius").GetAsync($"{Path}/me")).ReadAsync<JsonElement>();

        Assert.Equal("user", me.GetProperty("kind").GetString());
        Assert.Equal("Vinicius", me.GetProperty("name").GetString());
        Assert.Equal((read, write, admin), (me.GetProperty("canRead").GetBoolean(), me.GetProperty("canWrite").GetBoolean(), me.GetProperty("canAdmin").GetBoolean()));
        Assert.Equal(roles.Split(','), me.GetProperty("roles").EnumerateArray().Select(role => role.GetString()));
    }

    [Fact]
    public async Task RoleClaims_AreAddedOnlyForTheThreeBoardRoles()
    {
        var me = await (await factory.BoardUser("lotties-board-reader,realm-admin,manage-users").GetAsync($"{Path}/me")).ReadAsync<JsonElement>();

        Assert.Equal(["lotties-board-reader"], me.GetProperty("roles").EnumerateArray().Select(role => role.GetString()));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Key_InBearerOrHeader_ReadsAndReportsItsScope(bool inHeader)
    {
        var secret = await factory.SeedKeyAsync(BoardKeyScope.Read, name: "Reader key");

        var me = await (await factory.KeyClient(secret, inHeader).GetAsync($"{Path}/me")).ReadAsync<JsonElement>();

        Assert.Equal(("api_key", "Reader key", "read"), (me.GetProperty("kind").GetString(), me.GetProperty("name").GetString(), me.GetProperty("scope").GetString()));
        Assert.Equal((true, false, false), (me.GetProperty("canRead").GetBoolean(), me.GetProperty("canWrite").GetBoolean(), me.GetProperty("canAdmin").GetBoolean()));
    }

    [Fact]
    public async Task ReadKey_CannotWrite_EveryWriteRouteIs403()
    {
        var item = await factory.BoardUser(BoardTestKit.Writer).CreateAsync(BoardTestKit.Item("Target"));
        var key = factory.KeyClient(await factory.SeedKeyAsync(BoardKeyScope.Read));

        var responses = new[]
        {
            await key.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item("Escalation")),
            await key.PostAsJsonAsync($"{Path}/items/bulk", new { items = new[] { BoardTestKit.Item("Escalation") } }),
            await key.PatchAsync(item.IdOf(), new { title = "Changed" }),
            await key.PostAsJsonAsync($"{Path}/items/{item.IdOf()}/comments", new { comment = "hi" }),
            await key.DeleteAsync($"{Path}/items/{item.IdOf()}"),
        };

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode));
        var stored = await factory.QueryAsync(context => context.BoardItems.SingleAsync(row => row.Id == item.IdOf()));
        Assert.Equal(("Target", false, 1), (stored.Title, stored.IsDeleted, stored.Version));
    }

    [Fact]
    public async Task WriteKey_WritesButNeverAdministers()
    {
        var key = factory.KeyClient(await factory.SeedKeyAsync(BoardKeyScope.Write, name: "Claude"));
        var created = await key.CreateAsync(BoardTestKit.Item("From the assistant", extra: ("side", "assistant")));
        await key.DeleteAsync($"{Path}/items/{created.IdOf()}");

        var responses = new[]
        {
            await key.GetAsync($"{Path}/keys"),
            await key.PostAsJsonAsync($"{Path}/keys", new { name = "Child key", scope = "write" }),
            await key.DeleteAsync($"{Path}/keys/{Guid.NewGuid()}"),
            await key.PostAsync($"{Path}/items/{created.IdOf()}/restore", null),
            await key.PutAsJsonAsync($"{Path}/topics/new-topic", new { name = "New" }),
            await key.GetAsync($"{Path}/items?includeDeleted=true"),
        };

        Assert.Equal(("api_key", "Claude"), (created.GetProperty("createdBy").GetProperty("kind").GetString(), created.GetProperty("createdBy").GetProperty("name").GetString()));
        Assert.All(responses, response => Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode));
    }

    [Theory]
    [InlineData("revoked")]
    [InlineData("expired")]
    [InlineData("unknown")]
    [InlineData("malformed")]
    public async Task InvalidKey_Is401InvalidBoardKey_EvenNextToAUserWithARole(string kind)
    {
        var secret = kind switch
        {
            "revoked" => await factory.SeedKeyAsync(BoardKeyScope.Write, revoked: true),
            "expired" => await factory.SeedKeyAsync(BoardKeyScope.Write, expired: true),
            "unknown" => BoardKeySecret.Generate(),
            _ => "lbk_short",
        };
        var client = factory.BoardUser(BoardTestKit.Admin);
        client.DefaultRequestHeaders.Add("X-Board-Key", secret);

        var response = await client.GetAsync($"{Path}/summary");

        await response.AssertProblemAsync(HttpStatusCode.Unauthorized, "invalid_board_key");
        Assert.Contains("invalid_token", response.Headers.WwwAuthenticate.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Key_WithTheRightPrefixButAnotherSecret_Is401()
    {
        var secret = await factory.SeedKeyAsync(BoardKeyScope.Write);
        var forged = secret[..20] + new string(secret[20..].Select(character => character == 'A' ? 'B' : 'A').ToArray());

        var response = await factory.KeyClient(forged).GetAsync($"{Path}/me");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Key_UseIsRecordedAtMostOncePerMinute()
    {
        var secret = await factory.SeedKeyAsync(BoardKeyScope.Read);
        var key = factory.KeyClient(secret);

        for (var call = 0; call < 3; call++)
        {
            await (await key.GetAsync($"{Path}/me")).ReadAsync<JsonElement>();
        }

        var stored = await factory.QueryAsync(context => context.BoardApiKeys.SingleAsync(row => row.KeyHash == BoardKeySecret.HashOf(secret)));
        Assert.Equal(1, stored.UseCount);
        Assert.NotNull(stored.LastUsedAt);
    }

    [Fact]
    public async Task CreateKey_ReturnsTheSecretOnce_StoresOnlyItsHash_AndTheKeyWorksUntilRevoked()
    {
        var admin = factory.BoardUser(BoardTestKit.Admin, name: "The Owner");

        var created = await (await admin.PostAsJsonAsync($"{Path}/keys", new { name = "Claude Code", scope = "write", allowedTopics = new[] { "product" } })).ReadAsync<JsonElement>();
        var secret = created.GetProperty("secret").GetString()!;
        var keyId = created.GetProperty("key").GetProperty("id").GetGuid();
        var listed = await (await admin.GetAsync($"{Path}/keys")).Content.ReadAsStringAsync();
        var working = await factory.KeyClient(secret).GetAsync($"{Path}/me");
        var revoke = await admin.DeleteAsync($"{Path}/keys/{keyId}");
        var revokedAgain = await admin.DeleteAsync($"{Path}/keys/{keyId}");
        var afterRevoke = await factory.KeyClient(secret).GetAsync($"{Path}/me");

        Assert.Matches("^lbk_[A-Za-z0-9_-]{43}$", secret);
        Assert.Equal(secret[..12], created.GetProperty("key").GetProperty("prefix").GetString());
        Assert.Equal("The Owner", created.GetProperty("key").GetProperty("createdBy").GetString());
        Assert.DoesNotContain(secret, listed, StringComparison.Ordinal);
        Assert.DoesNotContain(BoardKeySecret.HashOf(secret), listed, StringComparison.Ordinal);
        Assert.Contains(secret[..12], listed, StringComparison.Ordinal);
        Assert.Equal(HttpStatusCode.OK, working.StatusCode);
        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (revoke.StatusCode, revokedAgain.StatusCode));
        Assert.Equal(HttpStatusCode.Unauthorized, afterRevoke.StatusCode);
        var stored = await factory.QueryAsync(context => context.BoardApiKeys.AsNoTracking().SingleAsync(row => row.Id == keyId));
        Assert.Equal(BoardKeySecret.HashOf(secret), stored.KeyHash);
        Assert.NotNull(stored.RevokedAt);
        await AssertDatabaseDoesNotContainAsync(secret);
    }

    [Theory]
    [InlineData(BoardTestKit.Reader)]
    [InlineData(BoardTestKit.Writer)]
    public async Task KeyManagement_IsForAdminsOnly(string role)
    {
        var user = factory.BoardUser(role);

        var responses = new[]
        {
            await user.GetAsync($"{Path}/keys"),
            await user.PostAsJsonAsync($"{Path}/keys", new { name = "Mine", scope = "read" }),
            await user.DeleteAsync($"{Path}/keys/{Guid.NewGuid()}"),
        };

        Assert.All(responses, response => Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode));
    }

    [Theory]
    [InlineData("""{"name":"k","scope":"admin"}""", "scope")]
    [InlineData("""{"name":"","scope":"read"}""", "name")]
    [InlineData("""{"name":"k","scope":"read","allowedTopics":[]}""", "allowedTopics")]
    [InlineData("""{"name":"k","scope":"read","expiresAt":"2020-01-01T00:00:00Z"}""", "expiresAt")]
    public async Task CreateKey_InvalidRequest_Is400(string body, string field)
    {
        var response = await factory.BoardUser(BoardTestKit.Admin).PostAsync($"{Path}/keys", new StringContent(body, System.Text.Encoding.UTF8, "application/json"));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task KeyLimitedToATopic_SeesAndWritesOnlyThatTopic()
    {
        var writer = factory.BoardUser(BoardTestKit.Writer);
        var elsewhere = await writer.CreateAsync(BoardTestKit.Item("In privacy", topic: "privacy-legal"));
        var key = factory.KeyClient(await factory.SeedKeyAsync(BoardKeyScope.Write, topics: ["design-ux"]));

        var created = await key.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item("Design note", topic: "design-ux"));
        var refused = await key.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item("Privacy note", topic: "privacy-legal"));
        var hidden = await key.GetAsync($"{Path}/items/{elsewhere.IdOf()}");
        var list = await (await key.GetAsync($"{Path}/items?limit=200")).ReadAsync<JsonElement>();
        var topics = await (await key.GetAsync($"{Path}/topics")).ReadAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        await refused.AssertProblemAsync(HttpStatusCode.Forbidden, "board_topic_not_allowed");
        await hidden.AssertProblemAsync(HttpStatusCode.NotFound, "board_item_not_found");
        Assert.All(list.GetProperty("items").EnumerateArray(), item => Assert.Equal("design-ux", item.GetProperty("topic").GetString()));
        Assert.Equal(["design-ux"], topics.EnumerateArray().Select(topic => topic.GetProperty("key").GetString()));
    }

    [Fact]
    public async Task RateLimit_IsPerKeyAndPerUser()
    {
        using var limited = factory.WithWebHostBuilder(builder => builder.UseSetting("RequestLimits:BoardPermitsPerMinute", "2"));
        var secret = await factory.SeedKeyAsync(BoardKeyScope.Read);
        var key = limited.CreateClient();
        key.DefaultRequestHeaders.Add("X-Board-Key", secret);
        var user = limited.CreateClient();
        user.DefaultRequestHeaders.Add(TestAuthHandler.SubjectHeader, TestUsers.NewSubject());
        user.DefaultRequestHeaders.Add(TestAuthHandler.RealmRolesHeader, BoardTestKit.Reader);

        var keyStatuses = new List<HttpStatusCode>();
        for (var call = 0; call < 3; call++)
        {
            keyStatuses.Add((await key.GetAsync($"{Path}/me")).StatusCode);
        }

        var userFirst = await user.GetAsync($"{Path}/me");

        Assert.Equal([HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.TooManyRequests], keyStatuses);
        Assert.Equal(HttpStatusCode.OK, userFirst.StatusCode);
    }

    [Fact]
    public async Task BoardRoles_GiveNoAccessToBabies()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.BoardUser(BoardTestKit.Admin).GetAsync($"/api/v1/babies/{baby.BabyId}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Key_IsNeverAUserOfTheApp()
    {
        var key = factory.KeyClient(await factory.SeedKeyAsync(BoardKeyScope.Write));
        var users = await factory.QueryAsync(context => context.Users.CountAsync());

        var babies = await key.GetAsync("/api/v1/babies");
        var me = await key.GetAsync("/api/v1/me");

        Assert.Equal((HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized), (babies.StatusCode, me.StatusCode));
        Assert.Equal(users, await factory.QueryAsync(context => context.Users.CountAsync()));
    }

    /// <summary>
    /// The database file (every table, index and free page of the SQLite test database) holds neither the secret nor its
    /// random part: only the hash and the 12-character prefix are ever written.
    /// </summary>
    private async Task AssertDatabaseDoesNotContainAsync(string secret)
    {
        var connection = await factory.QueryAsync(context => Task.FromResult(context.Database.GetConnectionString()!));
        var path = new Microsoft.Data.Sqlite.SqliteConnectionStringBuilder(connection).DataSource;
        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer);
        var bytes = buffer.ToArray();

        Assert.Equal(-1, bytes.AsSpan().IndexOf(System.Text.Encoding.UTF8.GetBytes(secret)));
        Assert.Equal(-1, bytes.AsSpan().IndexOf(System.Text.Encoding.UTF8.GetBytes(secret[12..])));
    }
}
