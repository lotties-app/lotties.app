using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Board;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Api.Tests.Board;

/// <summary>The board's items (docs/design/36-project-board.md section 3): writes, history, concurrency, soft delete, topics.</summary>
public sealed class BoardItemEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = BoardTestKit.Path;

    private HttpClient Writer => factory.BoardUser(BoardTestKit.Writer, name: "The Owner");

    [Fact]
    public async Task Create_ReturnsTheItemWithDefaultsLocationAndETag_AndRecordsCreated()
    {
        var response = await Writer.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item(
            "  Ship the board  ",
            extra: [("labels", new[] { "API", "board", "api" }), ("links", new[] { new { label = "Design", url = "https://lotties.app/docs/36" } }), ("dueDate", "2026-11-01"), ("source", "conversation 2026-10-24")]));

        var item = await response.ReadAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal($"/api/v1/board/items/{item.IdOf()}", response.Headers.Location?.ToString());
        Assert.Equal("\"1\"", response.Headers.ETag?.ToString());
        Assert.Equal(("task", "product", "Ship the board", "open", "both", "normal"), (Text(item, "type"), Text(item, "topic"), Text(item, "title"), Text(item, "status"), Text(item, "side"), Text(item, "priority")));
        Assert.Equal(["api", "board"], item.GetProperty("labels").EnumerateArray().Select(label => label.GetString()));
        Assert.Equal("2026-11-01", Text(item, "dueDate"));
        Assert.Equal("https://lotties.app/docs/36", item.GetProperty("links")[0].GetProperty("url").GetString());
        Assert.Equal(("user", "The Owner"), (Text(item.GetProperty("createdBy"), "kind"), Text(item.GetProperty("createdBy"), "name")));
        Assert.False(item.GetProperty("createdBy").TryGetProperty("userId", out _));
        Assert.Equal(JsonValueKind.Null, item.GetProperty("decision").ValueKind);
        var history = await HistoryAsync(item.IdOf());
        Assert.Equal(["created"], history.Select(entry => Text(entry, "kind")));
    }

    [Fact]
    public async Task Create_WithAClientIdTwice_IsIdempotent()
    {
        var id = Guid.NewGuid();
        var body = BoardTestKit.Item("Retry me", extra: ("id", id));

        var first = await Writer.PostAsJsonAsync($"{Path}/items", body);
        var second = await Writer.PostAsJsonAsync($"{Path}/items", body);

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.OK), (first.StatusCode, second.StatusCode));
        Assert.Equal(1, await factory.QueryAsync(context => context.BoardItems.CountAsync(item => item.Id == id)));
        Assert.Single(await HistoryAsync(id));
    }

    [Theory]
    [InlineData("""{"type":"task","topic":"product"}""", "title")]
    [InlineData("""{"type":"chore","topic":"product","title":"x"}""", "type")]
    [InlineData("""{"type":"task","topic":"product","title":"x","statuz":"open"}""", "statuz")]
    [InlineData("""{"type":"task","topic":"product","title":"x","status":"closed"}""", "status")]
    [InlineData("""{"type":"task","topic":"product","title":"x","pinned":true}""", "pinned")]
    [InlineData("""{"type":"task","topic":"product","title":"x","decisionSummary":"y"}""", "decisionSummary")]
    [InlineData("""{"type":"task","topic":"product","title":"x","links":[{"label":"evil","url":"javascript:alert(1)"}]}""", "links")]
    [InlineData("""{"type":"task","topic":"product","title":"x","links":[{"label":"ftp","url":"ftp://example.com/a"}]}""", "links")]
    [InlineData("""{"type":"task","topic":"product","title":"x","labels":["a","b","c","d","e","f","g","h","i","j","k"]}""", "labels")]
    [InlineData("""{"type":"task","topic":"product","title":"x","labels":["has space"]}""", "labels")]
    [InlineData("""{"type":"task","topic":"product","title":"x","dueDate":"01/11/2026"}""", "dueDate")]
    [InlineData("""{"type":"task","topic":"Product!","title":"x"}""", "topic")]
    [InlineData("""{"type":"task","topic":"product","title":5}""", "title")]
    public async Task Create_InvalidBody_Is400NamingTheField(string body, string field)
    {
        var response = await Writer.PostAsync($"{Path}/items", new StringContent(body, Encoding.UTF8, "application/json"));

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal(field, problem.GetProperty("field").GetString());
    }

    [Fact]
    public async Task Create_TitleAndBodyLimits_AreEnforced()
    {
        var longTitle = await Writer.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item(new string('t', 201)));
        var longBody = await Writer.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item("Body", extra: ("body", new string('b', 20001))));
        var maxBody = await Writer.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item(new string('t', 200), extra: ("body", new string('b', 20000))));

        Assert.Equal("title", (await longTitle.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        Assert.Equal("body", (await longBody.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        Assert.Equal(HttpStatusCode.Created, maxBody.StatusCode);
    }

    [Fact]
    public async Task Create_RequestBodyOverTheBoardLimit_Is413()
    {
        var body = JsonSerializer.Serialize(BoardTestKit.Item("Huge", extra: ("body", new string('b', 300 * 1024))));

        var response = await Writer.PostAsync($"{Path}/items", new StringContent(body, Encoding.UTF8, "application/json"));

        await response.AssertProblemAsync(HttpStatusCode.RequestEntityTooLarge, "request_body_too_large");
    }

    [Fact]
    public async Task Create_UnknownOrArchivedTopic_Is422()
    {
        var admin = factory.BoardUser(BoardTestKit.Admin);
        var archived = BoardTestKit.Unique("old");
        await (await admin.PutAsJsonAsync($"{Path}/topics/{archived}", new { name = "Old", archived = true })).ReadAsync<JsonElement>();

        var unknown = await Writer.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item("x", topic: "no-such-topic"));
        var intoArchived = await Writer.PostAsJsonAsync($"{Path}/items", BoardTestKit.Item("x", topic: archived));

        await unknown.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "board_unknown_topic");
        await intoArchived.AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "board_topic_archived");
    }

    [Fact]
    public async Task Topics_SeededTenInOrder_AdminAddsAndArchives()
    {
        var admin = factory.BoardUser(BoardTestKit.Admin);
        var key = BoardTestKit.Unique("extra");

        var created = await admin.PutAsJsonAsync($"{Path}/topics/{key}", new { name = "Extra", description = "Added later" });
        var renamed = await admin.PutAsJsonAsync($"{Path}/topics/{key}", new { name = "Extra topic", archived = true });
        var reader = factory.BoardUser(BoardTestKit.Reader);
        var active = await (await reader.GetAsync($"{Path}/topics")).ReadAsync<JsonElement>();
        var all = await (await reader.GetAsync($"{Path}/topics?includeArchived=true")).ReadAsync<JsonElement>();

        Assert.Equal((HttpStatusCode.Created, HttpStatusCode.OK), (created.StatusCode, renamed.StatusCode));
        var seeded = active.EnumerateArray().Select(topic => topic.GetProperty("key").GetString()).Take(10);
        Assert.Equal(
            ["product", "doctor-access", "assistants-alexa-mcp", "privacy-legal", "mobile-stores", "infrastructure-deploy", "data-catalog", "predictions-ml", "design-ux", "process-meta"],
            seeded);
        Assert.DoesNotContain(active.EnumerateArray(), topic => topic.GetProperty("key").GetString() == key);
        var extra = Assert.Single(all.EnumerateArray(), topic => topic.GetProperty("key").GetString() == key);
        Assert.Equal(("Extra topic", true), (Text(extra, "name"), extra.GetProperty("archived").GetBoolean()));
    }

    [Fact]
    public async Task Patch_ChangesFields_ClosesAndReopens_AndRecordsHistoryWithFromAndTo()
    {
        var item = await Writer.CreateAsync(BoardTestKit.Item("Fix the login", extra: ("body", new string('x', 500))));
        var id = item.IdOf();

        var renamed = await (await Writer.PatchAsync(id, new { title = "Fix the sign-in", priority = "high", body = (string?)null }, ifMatch: 1)).ReadAsync<JsonElement>();
        var closed = await (await Writer.PatchAsync(id, new { status = "done", version = 2 })).ReadAsync<JsonElement>();
        var reopened = await (await Writer.PatchAsync(id, new { status = "in_progress" })).ReadAsync<JsonElement>();

        Assert.Equal(("Fix the sign-in", "high", JsonValueKind.Null, 2), (Text(renamed, "title"), Text(renamed, "priority"), renamed.GetProperty("body").ValueKind, renamed.GetProperty("version").GetInt32()));
        Assert.NotEqual(JsonValueKind.Null, closed.GetProperty("closedAt").ValueKind);
        Assert.Equal((JsonValueKind.Null, 4), (reopened.GetProperty("closedAt").ValueKind, reopened.GetProperty("version").GetInt32()));
        var history = await HistoryAsync(id);
        Assert.Equal(["created", "updated", "status_changed", "status_changed"], history.Select(entry => Text(entry, "kind")));
        var changes = history[1].GetProperty("changes").EnumerateArray().ToDictionary(change => Text(change, "field")!);
        Assert.Equal(("Fix the login", "Fix the sign-in"), (Text(changes["title"], "from"), Text(changes["title"], "to")));
        Assert.Equal(("normal", "high"), (Text(changes["priority"], "from"), Text(changes["priority"], "to")));
        Assert.Equal(200, Text(changes["body"], "from")!.Length);
        Assert.EndsWith("…", Text(changes["body"], "from"), StringComparison.Ordinal);
        Assert.Equal(("open", "done"), (Text(history[2].GetProperty("changes")[0], "from"), Text(history[2].GetProperty("changes")[0], "to")));
    }

    [Fact]
    public async Task Patch_StaleVersion_Is412WithTheCurrentVersion_AndChangesNothing()
    {
        var item = await Writer.CreateAsync(BoardTestKit.Item("Race"));
        await (await Writer.PatchAsync(item.IdOf(), new { title = "First writer" }, ifMatch: 1)).ReadAsync<JsonElement>();

        var stale = await Writer.PatchAsync(item.IdOf(), new { title = "Second writer" }, ifMatch: 1);
        var staleInBody = await Writer.PatchAsync(item.IdOf(), new { title = "Second writer", version = 1 });

        var problem = await stale.AssertProblemAsync(HttpStatusCode.PreconditionFailed, "board_version_mismatch");
        Assert.Equal(2, problem.GetProperty("currentVersion").GetInt32());
        await staleInBody.AssertProblemAsync(HttpStatusCode.PreconditionFailed, "board_version_mismatch");
        var stored = await factory.QueryAsync(context => context.BoardItems.SingleAsync(row => row.Id == item.IdOf()));
        Assert.Equal(("First writer", 2), (stored.Title, stored.Version));
    }

    [Fact]
    public async Task Save_AfterAConcurrentWriteBetweenReadAndSave_IsConcurrentModification()
    {
        var item = await Writer.CreateAsync(BoardTestKit.Item("Racing save"));
        await using var scope = factory.Services.CreateAsyncScope();
        var board = scope.ServiceProvider.GetRequiredService<IBoardRepository>();
        var loaded = (await board.FindItemAsync(item.IdOf()))!;
        await (await Writer.PatchAsync(item.IdOf(), new { title = "Won the race" })).ReadAsync<JsonElement>();
        var content = BoardItemContent.Create(loaded.Type, loaded.TopicKey, "Lost the race", null, loaded.Status, loaded.Side, loaded.Priority, null, null, null, false, null, null, null, null);
        loaded.Edit(content, BoardActor.ForUser(Guid.NewGuid(), "Racer"), DateTimeOffset.UtcNow);

        var conflict = await Assert.ThrowsAsync<Lotties.Domain.Exceptions.ConcurrentModificationException>(() => board.SaveChangesAsync());

        Assert.Equal("concurrent_modification", conflict.Code);
        var stored = await factory.QueryAsync(other => other.BoardItems.SingleAsync(row => row.Id == item.IdOf()));
        Assert.Equal(("Won the race", 2), (stored.Title, stored.Version));
    }

    [Fact]
    public async Task Patch_SameValues_ChangesNothing()
    {
        var item = await Writer.CreateAsync(BoardTestKit.Item("Steady"));

        var patched = await (await Writer.PatchAsync(item.IdOf(), new { title = "Steady", status = "open" })).ReadAsync<JsonElement>();

        Assert.Equal(1, patched.GetProperty("version").GetInt32());
        Assert.Single(await HistoryAsync(item.IdOf()));
    }

    [Fact]
    public async Task Decision_GetsItsTimeAndADecidedEntry_AndTypeRulesHold()
    {
        var item = await Writer.CreateAsync(BoardTestKit.Item("Board key format", type: "decision"));

        var decided = await (await Writer.PatchAsync(item.IdOf(), new { decisionSummary = "lbk_ + 43 base64url", rationale = "Scanner friendly", status = "done" })).ReadAsync<JsonElement>();
        var history = await HistoryAsync(item.IdOf());
        var memory = await Writer.CreateAsync(BoardTestKit.Item("Owner prefers short answers", type: "memory", extra: ("pinned", true)));
        var toTask = await Writer.PatchAsync(memory.IdOf(), new { type = "task" });

        Assert.Equal("lbk_ + 43 base64url", Text(decided.GetProperty("decision"), "summary"));
        Assert.NotEqual(JsonValueKind.Null, decided.GetProperty("decision").GetProperty("decidedAt").ValueKind);
        Assert.Equal("status_changed", Text(history[^1], "kind"));
        Assert.True(memory.GetProperty("pinned").GetBoolean());
        Assert.Equal("pinned", (await toTask.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
    }

    [Fact]
    public async Task Comment_AddsAnEntryAndBumpsTheVersion()
    {
        var item = await Writer.CreateAsync(BoardTestKit.Item("Discuss"));

        var response = await Writer.PostAsJsonAsync($"{Path}/items/{item.IdOf()}/comments", new { comment = "Waiting on Keycloak." });
        var empty = await Writer.PostAsJsonAsync($"{Path}/items/{item.IdOf()}/comments", new { comment = " " });
        var tooLong = await Writer.PostAsJsonAsync($"{Path}/items/{item.IdOf()}/comments", new { comment = new string('c', 4001) });

        var entry = await response.ReadAsync<JsonElement>();
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(("commented", "Waiting on Keycloak.", "The Owner"), (Text(entry, "kind"), Text(entry, "comment"), Text(entry.GetProperty("actor"), "name")));
        await empty.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        await tooLong.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        var detail = await (await Writer.GetAsync($"{Path}/items/{item.IdOf()}")).ReadAsync<JsonElement>();
        Assert.Equal(2, detail.GetProperty("item").GetProperty("version").GetInt32());
    }

    [Fact]
    public async Task Delete_IsSoft_HiddenFromNonAdmins_RestoredByAnAdmin()
    {
        var item = await Writer.CreateAsync(BoardTestKit.Item("Remove me"));
        var id = item.IdOf();
        var admin = factory.BoardUser(BoardTestKit.Admin);

        var deleted = await Writer.DeleteAsync($"{Path}/items/{id}");
        var again = await Writer.DeleteAsync($"{Path}/items/{id}");
        var hidden = await Writer.GetAsync($"{Path}/items/{id}");
        var patch = await Writer.PatchAsync(id, new { title = "Edit after delete" });
        var comment = await Writer.PostAsJsonAsync($"{Path}/items/{id}/comments", new { comment = "hello" });
        var adminSees = await admin.GetAsync($"{Path}/items/{id}");
        var writerRestore = await Writer.PostAsync($"{Path}/items/{id}/restore", null);
        var restored = await (await admin.PostAsync($"{Path}/items/{id}/restore", null)).ReadAsync<JsonElement>();
        var visible = await Writer.GetAsync($"{Path}/items/{id}");

        Assert.Equal((HttpStatusCode.NoContent, HttpStatusCode.NoContent), (deleted.StatusCode, again.StatusCode));
        await hidden.AssertProblemAsync(HttpStatusCode.NotFound, "board_item_not_found");
        await patch.AssertProblemAsync(HttpStatusCode.Conflict, "board_item_deleted");
        await comment.AssertProblemAsync(HttpStatusCode.Conflict, "board_item_deleted");
        Assert.Equal(HttpStatusCode.OK, adminSees.StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, writerRestore.StatusCode);
        Assert.Equal(JsonValueKind.Null, restored.GetProperty("deletedAt").ValueKind);
        Assert.Equal(HttpStatusCode.OK, visible.StatusCode);
        Assert.Equal(["created", "deleted", "restored"], (await HistoryAsync(id)).Select(entry => Text(entry, "kind")));
        Assert.True(await factory.QueryAsync(context => context.BoardItems.AnyAsync(row => row.Id == id)));
    }

    [Fact]
    public async Task Get_UnknownItem_Is404()
    {
        var response = await Writer.GetAsync($"{Path}/items/{Guid.NewGuid()}");

        await response.AssertProblemAsync(HttpStatusCode.NotFound, "board_item_not_found");
    }

    [Fact]
    public async Task Get_HasTheETagOfTheVersion()
    {
        var item = await Writer.CreateAsync(BoardTestKit.Item("Tagged"));
        await (await Writer.PatchAsync(item.IdOf(), new { title = "Tagged twice" })).ReadAsync<JsonElement>();

        var response = await Writer.GetAsync($"{Path}/items/{item.IdOf()}");

        Assert.Equal("\"2\"", response.Headers.ETag?.ToString());
    }

    [Fact]
    public async Task Patch_InvalidIfMatch_Is400()
    {
        var item = await Writer.CreateAsync(BoardTestKit.Item("Bad tag"));

        var request = new HttpRequestMessage(HttpMethod.Patch, $"{Path}/items/{item.IdOf()}") { Content = JsonContent.Create(new { title = "x" }) };
        request.Headers.TryAddWithoutValidation("If-Match", "\"abc\"");
        var response = await Writer.SendAsync(request);

        Assert.Equal("If-Match", (await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
    }

    private async Task<IReadOnlyList<JsonElement>> HistoryAsync(Guid id)
    {
        var detail = await (await factory.BoardUser(BoardTestKit.Admin).GetAsync($"{Path}/items/{id}")).ReadAsync<JsonElement>();
        return detail.GetProperty("history").EnumerateArray().ToArray();
    }

    private static string? Text(JsonElement element, string property) => element.GetProperty(property).GetString();
}
