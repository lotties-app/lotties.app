using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Board;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Board;

/// <summary>
/// Reading the board (docs/design/36-project-board.md sections 3.2-3.4): filters, search, sort and cursor pages, the bulk
/// import's idempotency by external key, the summary numbers and the export. Each test works in a topic of its own (the
/// board is instance-wide), or in a fresh database for the summary.
/// </summary>
public sealed class BoardQueryEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private const string Path = BoardTestKit.Path;

    private HttpClient Writer => factory.BoardUser(BoardTestKit.Writer);

    [Fact]
    public async Task List_FiltersCombine()
    {
        var topic = await NewTopicAsync(factory);
        await Writer.CreateAsync(BoardTestKit.Item("Owner high task", topic, extra: [("side", "owner"), ("priority", "high"), ("labels", new[] { "keycloak" })]));
        await Writer.CreateAsync(BoardTestKit.Item("Assistant gap", topic, "gap", ("side", "assistant"), ("status", "blocked")));
        await Writer.CreateAsync(BoardTestKit.Item("Done task", topic, extra: [("status", "done"), ("labels", new[] { "keycloak", "deploy" })]));
        await Writer.CreateAsync(BoardTestKit.Item("Pinned memory", topic, "memory", ("pinned", true)));

        Assert.Equal(["Owner high task"], await TitlesAsync($"topic={topic}&side=owner"));
        Assert.Equal(["Assistant gap"], await TitlesAsync($"topic={topic}&type=gap,risk&status=blocked"));
        Assert.Equal(["Done task", "Owner high task"], await TitlesAsync($"topic={topic}&label=keycloak&sort=created", sorted: true));
        Assert.Equal(["Done task"], await TitlesAsync($"topic={topic}&open=false"));
        Assert.Equal(["Pinned memory"], await TitlesAsync($"topic={topic}&pinned=true"));
        Assert.Equal(["Owner high task"], await TitlesAsync($"topic={topic}&priority=high&priority=urgent"));
        Assert.Equal(3, (await TitlesAsync($"topic={topic}&open=true")).Count);
    }

    [Fact]
    public async Task List_SearchIsCaseInsensitiveOnTitleAndBody_AndHandlesWildcards()
    {
        var topic = await NewTopicAsync(factory);
        await Writer.CreateAsync(BoardTestKit.Item("Rotate the KEYCLOAK secret", topic));
        await Writer.CreateAsync(BoardTestKit.Item("Something else", topic, extra: ("body", "Needs keycloak admin access")));
        await Writer.CreateAsync(BoardTestKit.Item("100% coverage_goal", topic));

        Assert.Equal(2, (await TitlesAsync($"topic={topic}&q=KeyCloak")).Count);
        Assert.Equal(["100% coverage_goal"], await TitlesAsync($"topic={topic}&q={Uri.EscapeDataString("100%")}"));
        Assert.Empty(await TitlesAsync($"topic={topic}&q=_x"));
    }

    [Fact]
    public async Task List_CursorPagesCoverEveryItemOnce_AndPrioritySortPutsUrgentFirst()
    {
        var topic = await NewTopicAsync(factory);
        var priorities = new[] { "low", "urgent", "normal", "high", "normal", "low", "urgent" };
        for (var index = 0; index < priorities.Length; index++)
        {
            await Writer.CreateAsync(BoardTestKit.Item($"Item {index}", topic, extra: ("priority", priorities[index])));
        }

        var seen = new List<string>();
        string? cursor = null;
        var pages = 0;
        do
        {
            var page = await (await Writer.GetAsync($"{Path}/items?topic={topic}&sort=priority&limit=3{(cursor is null ? string.Empty : $"&cursor={cursor}")}")).ReadAsync<JsonElement>();
            seen.AddRange(page.GetProperty("items").EnumerateArray().Select(item => item.GetProperty("priority").GetString()!));
            cursor = page.GetProperty("nextCursor").GetString();
            pages++;
        }
        while (cursor is not null);

        Assert.Equal(3, pages);
        Assert.Equal(["urgent", "urgent", "high", "normal", "normal", "low", "low"], seen);
    }

    [Theory]
    [InlineData("cursor=bm90LWEtY3Vyc29y", "invalid_cursor")]
    [InlineData("limit=0", "validation_failed")]
    [InlineData("limit=201", "validation_failed")]
    [InlineData("sort=random", "validation_failed")]
    [InlineData("status=closed", "validation_failed")]
    [InlineData("label=has%20space", "validation_failed")]
    public async Task List_InvalidQuery_Is400(string query, string code)
    {
        var response = await Writer.GetAsync($"{Path}/items?{query}");

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, code);
    }

    [Fact]
    public async Task List_CursorOfAnotherSort_Is400()
    {
        var topic = await NewTopicAsync(factory);
        await Writer.CreateAsync(BoardTestKit.Item("One", topic));
        await Writer.CreateAsync(BoardTestKit.Item("Two", topic));
        var page = await (await Writer.GetAsync($"{Path}/items?topic={topic}&limit=1")).ReadAsync<JsonElement>();

        var response = await Writer.GetAsync($"{Path}/items?topic={topic}&limit=1&sort=due&cursor={page.GetProperty("nextCursor").GetString()}");

        await response.AssertProblemAsync(HttpStatusCode.BadRequest, "invalid_cursor");
    }

    [Fact]
    public async Task List_DeletedItems_OnlyForAdminsOnRequest_AndUpdatedSinceFilters()
    {
        var topic = await NewTopicAsync(factory);
        var gone = await Writer.CreateAsync(BoardTestKit.Item("Gone", topic));
        await Writer.DeleteAsync($"{Path}/items/{gone.IdOf()}");
        var cutoff = DateTimeOffset.UtcNow;
        await Task.Delay(20);
        await Writer.CreateAsync(BoardTestKit.Item("Fresh", topic));

        var writerList = await TitlesAsync($"topic={topic}");
        var writerDeleted = await Writer.GetAsync($"{Path}/items?topic={topic}&includeDeleted=true");
        var adminList = await (await factory.BoardUser(BoardTestKit.Admin).GetAsync($"{Path}/items?topic={topic}&includeDeleted=true")).ReadAsync<JsonElement>();
        var since = await TitlesAsync($"topic={topic}&updatedSince={Uri.EscapeDataString(cutoff.ToString("O"))}");

        Assert.Equal(["Fresh"], writerList);
        await writerDeleted.AssertProblemAsync(HttpStatusCode.Forbidden, "board_admin_required");
        Assert.Equal(2, adminList.GetProperty("items").GetArrayLength());
        Assert.Equal(["Fresh"], since);
    }

    [Fact]
    public async Task List_ItemsHaveAnExcerptInsteadOfTheBody()
    {
        var topic = await NewTopicAsync(factory);
        await Writer.CreateAsync(BoardTestKit.Item("Long", topic, extra: ("body", new string('b', 1000))));

        var page = await (await Writer.GetAsync($"{Path}/items?topic={topic}")).ReadAsync<JsonElement>();
        var item = Assert.Single(page.GetProperty("items").EnumerateArray());

        Assert.False(item.TryGetProperty("body", out _));
        Assert.Equal(200, item.GetProperty("excerpt").GetString()!.Length);
    }

    [Fact]
    public async Task Bulk_IsIdempotentByExternalKey_UpdatesOnlyUntouchedItems_AndNeverResurrects()
    {
        var topic = await NewTopicAsync(factory);
        var prefix = BoardTestKit.Unique("checklist");
        object Entry(string key, string title, string priority = "normal") =>
            BoardTestKit.Item(title, topic, extra: [("externalKey", $"{prefix}:{key}"), ("priority", priority), ("source", "docs/PRIVACY-OWNER-CHECKLIST.md")]);

        var first = await BulkAsync(Entry("C1", "Confirm hosting"), Entry("C2", "Confirm backups"), Entry("C3", "Confirm SMTP"), Entry("C4", "Confirm DPO"));
        var replay = await BulkAsync(Entry("C1", "Confirm hosting"), Entry("C2", "Confirm backups"), Entry("C3", "Confirm SMTP"), Entry("C4", "Confirm DPO"));
        var c2 = first[1].GetProperty("id").GetGuid();
        var c3 = first[2].GetProperty("id").GetGuid();
        var c4 = first[3].GetProperty("id").GetGuid();
        await (await Writer.PatchAsync(c2, new { status = "done" })).ReadAsync<JsonElement>();
        await Writer.DeleteAsync($"{Path}/items/{c4}");
        var second = await BulkAsync(
            Entry("C1", "Confirm hosting"),
            Entry("C2", "Confirm backups (rewritten)"),
            Entry("C3", "Confirm SMTP relay", "high"),
            Entry("C4", "Confirm DPO"),
            Entry("C5", "Confirm Cloudflare proxy"));
        var third = await BulkAsync(Entry("C3", "Confirm SMTP relay again", "urgent"));

        Assert.Equal(["created", "created", "created", "created"], Outcomes(first));
        Assert.Equal(["unchanged", "unchanged", "unchanged", "unchanged"], Outcomes(replay));
        Assert.Equal(["unchanged", "kept", "updated", "deleted", "created"], Outcomes(second));
        Assert.Equal(["updated"], Outcomes(third));
        var stored = await factory.QueryAsync(context => context.BoardItems.Where(item => item.TopicKey == topic).ToListAsync());
        Assert.Equal(5, stored.Count);
        Assert.Equal(("Confirm backups", BoardItemStatus.Done), (stored.Single(item => item.Id == c2).Title, stored.Single(item => item.Id == c2).Status));
        Assert.Equal(("Confirm SMTP relay again", BoardPriority.Urgent), (stored.Single(item => item.Id == c3).Title, stored.Single(item => item.Id == c3).Priority));
        Assert.True(stored.Single(item => item.Id == c4).IsDeleted);
    }

    [Fact]
    public async Task Bulk_InvalidEntry_SavesNothingAndNamesTheEntry()
    {
        var topic = await NewTopicAsync(factory);
        var body = new { items = new object[] { BoardTestKit.Item("Valid", topic), BoardTestKit.Item(string.Empty, topic) } };

        var response = await Writer.PostAsJsonAsync($"{Path}/items/bulk", body);

        var problem = await response.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("items[1].title", problem.GetProperty("field").GetString());
        Assert.Equal(0, await factory.QueryAsync(context => context.BoardItems.CountAsync(item => item.TopicKey == topic)));
    }

    [Fact]
    public async Task Bulk_SizeRules()
    {
        var topic = await NewTopicAsync(factory);
        var tooMany = new { items = Enumerable.Range(0, 101).Select(index => BoardTestKit.Item($"Item {index}", topic)).ToArray() };
        var duplicateKeys = new { items = new[] { BoardTestKit.Item("A", topic, extra: ("externalKey", "dup:1")), BoardTestKit.Item("B", topic, extra: ("externalKey", "dup:1")) } };
        var hundredLong = new { items = Enumerable.Range(0, 100).Select(index => BoardTestKit.Item($"Long {index}", topic, extra: ("body", new string('b', 20000)))).ToArray() };

        var many = await Writer.PostAsJsonAsync($"{Path}/items/bulk", tooMany);
        var empty = await Writer.PostAsJsonAsync($"{Path}/items/bulk", new { items = Array.Empty<object>() });
        var duplicates = await Writer.PostAsJsonAsync($"{Path}/items/bulk", duplicateKeys);
        var big = await Writer.PostAsJsonAsync($"{Path}/items/bulk", hundredLong);
        var tooBig = await Writer.PostAsync(
            $"{Path}/items/bulk",
            new StringContent(JsonSerializer.Serialize(new { items = new[] { BoardTestKit.Item("Huge", topic, extra: ("body", new string('b', (4 * 1024 * 1024) + 1))) } }), Encoding.UTF8, "application/json"));

        await tooBig.AssertProblemAsync(HttpStatusCode.RequestEntityTooLarge, "request_body_too_large");
        Assert.Equal("items", (await many.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        await empty.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("items[1].externalKey", (await duplicates.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed")).GetProperty("field").GetString());
        Assert.Equal(100, (await big.ReadAsync<JsonElement>()).GetProperty("results").GetArrayLength());
    }

    [Fact]
    public async Task Summary_CountsAndListsOnAKnownBoard()
    {
        using var fresh = new ApiFactory();
        var writer = fresh.BoardUser(BoardTestKit.Writer);
        await writer.CreateAsync(BoardTestKit.Item("Owner urgent", extra: [("side", "owner"), ("priority", "urgent")]));
        await writer.CreateAsync(BoardTestKit.Item("Owner overdue", extra: [("side", "owner"), ("dueDate", "2020-01-01")]));
        await writer.CreateAsync(BoardTestKit.Item("Shared blocked", "privacy-legal", "gap", ("side", "both"), ("status", "blocked")));
        await writer.CreateAsync(BoardTestKit.Item("Assistant low", extra: [("side", "assistant"), ("priority", "low")]));
        await writer.CreateAsync(BoardTestKit.Item("Assistant done", extra: [("side", "assistant"), ("status", "done")]));
        await writer.CreateAsync(BoardTestKit.Item("Key format", "process-meta", "decision", ("decisionSummary", "lbk_ prefix"), ("status", "done")));
        await writer.CreateAsync(BoardTestKit.Item("Undecided", "process-meta", "decision"));
        var deleted = await writer.CreateAsync(BoardTestKit.Item("Deleted owner", extra: ("side", "owner")));
        await writer.DeleteAsync($"{Path}/items/{deleted.IdOf()}");

        var summary = await (await writer.GetAsync($"{Path}/summary?top=2")).ReadAsync<JsonElement>();

        var totals = summary.GetProperty("totals");
        // Open: both owner items, the blocked gap (side both), the low assistant item and the undecided decision (side both).
        Assert.Equal((5, 4, 3, 1, 1), (Int(totals, "open"), Int(totals, "waitingOnOwner"), Int(totals, "waitingOnAssistant"), Int(totals, "blocked"), Int(totals, "overdue")));

        // Priority first, then a due date before none, then the newest update.
        Assert.Equal(["Owner urgent", "Owner overdue"], Titles(summary.GetProperty("waitingOnOwner")));
        Assert.Equal(["Undecided", "Shared blocked"], Titles(summary.GetProperty("waitingOnAssistant")));
        Assert.Equal(["Key format"], Titles(summary.GetProperty("recentDecisions")));
        Assert.Equal(2, summary.GetProperty("recentlyUpdated").GetArrayLength());
        var counts = summary.GetProperty("counts").EnumerateArray().ToArray();
        Assert.Equal(7, counts.Sum(count => Int(count, "count")));
        Assert.Contains(counts, count => count.GetProperty("topic").GetString() == "privacy-legal" && count.GetProperty("side").GetString() == "both" && count.GetProperty("status").GetString() == "blocked" && Int(count, "count") == 1);
        var badTop = await writer.GetAsync($"{Path}/summary?top=51");
        await badTop.AssertProblemAsync(HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Export_HasTopicsItemsAndHistory_DeletedOnlyForAdmins_NeverKeys()
    {
        using var fresh = new ApiFactory();
        var writer = fresh.BoardUser(BoardTestKit.Writer);
        var kept = await writer.CreateAsync(BoardTestKit.Item("Kept", extra: ("body", "Full body text")));
        await writer.PostAsJsonAsync($"{Path}/items/{kept.IdOf()}/comments", new { comment = "Noted" });
        var gone = await writer.CreateAsync(BoardTestKit.Item("Gone"));
        await writer.DeleteAsync($"{Path}/items/{gone.IdOf()}");
        var secret = await fresh.SeedKeyAsync(BoardKeyScope.Read, name: "Exported key?");

        var forWriter = await (await writer.GetAsync($"{Path}/export")).ReadAsync<JsonElement>();
        var forAdminResponse = await fresh.BoardUser(BoardTestKit.Admin).GetAsync($"{Path}/export");
        var forAdmin = await forAdminResponse.ReadAsync<JsonElement>();
        var raw = await forAdminResponse.Content.ReadAsStringAsync();

        Assert.Equal(("lotties-board", 1), (forWriter.GetProperty("format").GetString(), Int(forWriter, "version")));
        Assert.Equal(10, forWriter.GetProperty("topics").GetArrayLength());
        var item = Assert.Single(forWriter.GetProperty("items").EnumerateArray());
        Assert.Equal("Full body text", item.GetProperty("item").GetProperty("body").GetString());
        Assert.Equal(["created", "commented"], item.GetProperty("history").EnumerateArray().Select(entry => entry.GetProperty("kind").GetString()));
        Assert.Equal(2, forAdmin.GetProperty("items").GetArrayLength());
        Assert.Equal("no-store", forAdminResponse.Headers.CacheControl?.ToString());
        Assert.DoesNotContain("Exported key?", raw, StringComparison.Ordinal);
        Assert.DoesNotContain(secret[..12], raw, StringComparison.Ordinal);
    }

    private static async Task<string> NewTopicAsync(ApiFactory host)
    {
        var key = BoardTestKit.Unique("t");
        await (await host.BoardUser(BoardTestKit.Admin).PutAsJsonAsync($"{Path}/topics/{key}", new { name = $"Topic {key}" })).ReadAsync<JsonElement>();
        return key;
    }

    private async Task<IReadOnlyList<string>> TitlesAsync(string query, bool sorted = false)
    {
        var page = await (await Writer.GetAsync($"{Path}/items?{query}")).ReadAsync<JsonElement>();
        var titles = Titles(page.GetProperty("items"));
        return sorted ? titles.Order(StringComparer.Ordinal).ToArray() : titles;
    }

    private async Task<IReadOnlyList<JsonElement>> BulkAsync(params object[] items)
    {
        var response = await Writer.PostAsync($"{Path}/items/bulk", new StringContent(JsonSerializer.Serialize(new { items }), Encoding.UTF8, "application/json"));
        return (await response.ReadAsync<JsonElement>()).GetProperty("results").EnumerateArray().ToArray();
    }

    private static IReadOnlyList<string> Outcomes(IReadOnlyList<JsonElement> results) => results.Select(result => result.GetProperty("outcome").GetString()!).ToArray();

    private static IReadOnlyList<string> Titles(JsonElement items) => items.EnumerateArray().Select(item => item.GetProperty("title").GetString()!).ToArray();

    private static int Int(JsonElement element, string property) => element.GetProperty(property).GetInt32();
}
