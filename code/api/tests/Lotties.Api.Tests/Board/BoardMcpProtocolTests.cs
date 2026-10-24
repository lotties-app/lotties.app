using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Board;
using ModelContextProtocol;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Lotties.Api.Tests.Board;

/// <summary>
/// The board's MCP endpoint through the official SDK client against the real endpoint (docs/design/36-project-board.md
/// section 9): both protocol eras, the tool list by caller (read key, write key, Keycloak reader, writer, admin), every tool's
/// success and typed errors, optimistic concurrency, idempotent creation by externalKey, and the history's actor.
/// </summary>
public sealed class BoardMcpProtocolTests(BoardMcpHost host) : IClassFixture<BoardMcpHost>
{
    private static readonly string[] ReadTools =
        ["board_summary", "board_list_topics", "board_list_items", "board_get_item", "board_search", "board_recent_changes"];

    private static readonly string[] WriteTools =
        ["board_create_item", "board_update_item", "board_set_status", "board_add_comment", "board_record_decision", "board_delete_item"];

    [Theory]
    [InlineData(null)]
    [InlineData(BoardMcpHost.LegacyProtocol)]
    public async Task Connect_BothEras_NameTheBoardServerAndListTheReadToolsOfAReadKey(string? protocol)
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Read), protocol);

        var tools = await client.ListToolsAsync();

        Assert.Equal("lotties-board", client.ServerInfo?.Name);
        Assert.Equal(protocol ?? BoardMcpHost.ModernProtocol, client.NegotiatedProtocolVersion);
        Assert.Contains("board_summary", client.ServerInstructions, StringComparison.Ordinal);
        Assert.Equal(ReadTools, tools.Select(tool => tool.Name));
    }

    [Fact]
    public async Task ListTools_WriteKey_ListsReadAndWriteTools_WithHintsAndStrictSchemas_AndNoBabyOrAdminTool()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));

        var tools = (await client.ListToolsAsync()).Select(tool => tool.ProtocolTool).ToArray();

        Assert.Equal(ReadTools.Concat(WriteTools), tools.Select(tool => tool.Name));
        Assert.All(tools, tool =>
        {
            Assert.False(tool.InputSchema.GetProperty("additionalProperties").GetBoolean());
            Assert.False(tool.Annotations!.OpenWorldHint);
            Assert.False(string.IsNullOrWhiteSpace(tool.Description));
            Assert.All(tool.InputSchema.GetProperty("properties").EnumerateObject(), property => Assert.True(property.Value.TryGetProperty("description", out _), $"{tool.Name}.{property.Name}"));
        });
        Assert.All(tools.Where(tool => ReadTools.Contains(tool.Name)), tool => Assert.Equal((true, false, true), (tool.Annotations!.ReadOnlyHint, tool.Annotations.DestructiveHint, tool.Annotations.IdempotentHint)));
        Assert.All(tools.Where(tool => WriteTools.Contains(tool.Name)), tool => Assert.False(tool.Annotations!.ReadOnlyHint));
        Assert.Equal(["board_delete_item"], tools.Where(tool => tool.Annotations!.DestructiveHint == true).Select(tool => tool.Name));
        Assert.Equal(["board_update_item", "board_delete_item"], tools.Where(tool => WriteTools.Contains(tool.Name) && tool.Annotations!.IdempotentHint == true).Select(tool => tool.Name));
        Assert.DoesNotContain(tools, tool => tool.Name is "list_babies" or "log_diaper" || tool.Name.Contains("restore", StringComparison.Ordinal) || tool.Name.Contains("key", StringComparison.Ordinal) || tool.Name.Contains("export", StringComparison.Ordinal));
        Assert.Equal(["id", "version"], Required(tools, "board_update_item"));
        Assert.Equal(["type", "topic", "title", "side"], Required(tools, "board_create_item"));
    }

    [Theory]
    [InlineData("lotties-board-reader", false)]
    [InlineData("lotties-board-writer", true)]
    [InlineData("lotties-board-admin", true)]
    [InlineData("lotties-board-reader,some-other-role", false)]
    public async Task ListTools_KeycloakUser_FollowsTheBoardRole(string roles, bool writes)
    {
        await using var client = await host.ClientAsync(host.UserToken(TestUsers.NewSubject(), roles));

        var tools = await client.ListToolsAsync();

        Assert.Equal(writes ? ReadTools.Concat(WriteTools) : ReadTools, tools.Select(tool => tool.Name));
    }

    [Fact]
    public async Task KeyInTheBoardKeyHeader_Works()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Read), inBoardKeyHeader: true);

        var summary = await client.CallToolAsync("board_summary", Args());

        Assert.NotEqual(true, summary.IsError);
    }

    [Fact]
    public async Task CreateGetUpdateStatusComment_WriteKey_RecordsTheKeyAsTheActor()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write, name: "Claude Code (dev)"));

        var created = await client.CallToolAsync("board_create_item", Args(("type", "task"), ("topic", "product"), ("title", "Write the import script"), ("side", "assistant"), ("labels", new[] { "tooling" }), ("body", "From docs/agents/PLAN.md")));
        var id = Item(created).GetProperty("id").GetGuid();
        var updated = await client.CallToolAsync("board_update_item", Args(("id", id.ToString()), ("version", 1), ("priority", "high"), ("body", null)));
        var status = await client.CallToolAsync("board_set_status", Args(("id", id.ToString()), ("status", "in_progress"), ("note", "Started")));
        var comment = await client.CallToolAsync("board_add_comment", Args(("id", id.ToString()), ("text", "Halfway")));
        var detail = await client.CallToolAsync("board_get_item", Args(("id", id.ToString())));

        Assert.All(new[] { created, updated, status, comment, detail }, result => Assert.NotEqual(true, result.IsError));
        Assert.True(Structured(created).GetProperty("created").GetBoolean());
        Assert.Equal(("high", 2), (Item(updated).GetProperty("priority").GetString(), Item(updated).GetProperty("version").GetInt32()));
        Assert.False(Item(updated).TryGetProperty("body", out _));
        Assert.Equal("in_progress", Item(status).GetProperty("status").GetString());
        Assert.Equal("Started", Structured(status).GetProperty("comment").GetProperty("comment").GetString());
        Assert.Equal("Halfway", Structured(comment).GetProperty("comment").GetProperty("comment").GetString());
        var history = Structured(detail).GetProperty("history").EnumerateArray().ToArray();
        Assert.Equal(["created", "updated", "status_changed", "commented", "commented"], history.Select(entry => entry.GetProperty("kind").GetString()));
        Assert.All(history, entry => Assert.Equal(("api_key", "Claude Code (dev)"), (entry.GetProperty("actor").GetProperty("kind").GetString(), entry.GetProperty("actor").GetProperty("name").GetString())));
        Assert.Equal(5, Structured(detail).GetProperty("historyTotal").GetInt32());
        Assert.Equal(("api_key", "Claude Code (dev)"), (Item(detail).GetProperty("createdBy").GetProperty("kind").GetString(), Item(detail).GetProperty("createdBy").GetProperty("name").GetString()));
        Assert.Contains("version", Text(detail), StringComparison.Ordinal);
        Assert.Equal(JsonSerializer.Serialize(Structured(detail)), JsonSerializer.Serialize(JsonDocument.Parse(((TextContentBlock)detail.Content[1]).Text).RootElement));
    }

    [Fact]
    public async Task Create_KeycloakWriter_RecordsTheUserByName_NeverHerId()
    {
        await using var client = await host.ClientAsync(host.UserToken(TestUsers.NewSubject(), "lotties-board-writer", name: "Owner Person"));

        var created = await client.CallToolAsync("board_create_item", Args(("type", "note"), ("topic", "process-meta"), ("title", "Use worktrees"), ("side", "both"), ("pinned", true)));

        Assert.NotEqual(true, created.IsError);
        Assert.Equal(("user", "Owner Person", true), (Item(created).GetProperty("createdBy").GetProperty("kind").GetString(), Item(created).GetProperty("createdBy").GetProperty("name").GetString(), Item(created).GetProperty("pinned").GetBoolean()));
        Assert.DoesNotContain("userId", JsonSerializer.Serialize(Structured(created)), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_SameExternalKeyTwice_CreatesOnce_TheRetryReturnsTheStoredItem()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));
        var key = BoardTestKit.Unique("mcp-retry");

        var first = await client.CallToolAsync("board_create_item", Args(("type", "gap"), ("topic", "product"), ("title", "First"), ("side", "owner"), ("externalKey", key)));
        var retry = await client.CallToolAsync("board_create_item", Args(("type", "gap"), ("topic", "product"), ("title", "Second wording"), ("side", "owner"), ("externalKey", key)));
        var search = await client.CallToolAsync("board_list_items", Args(("q", "Second wording")));

        Assert.Equal((true, false), (Structured(first).GetProperty("created").GetBoolean(), Structured(retry).GetProperty("created").GetBoolean()));
        Assert.Equal(Item(first).GetProperty("id").GetGuid(), Item(retry).GetProperty("id").GetGuid());
        Assert.Equal("First", Item(retry).GetProperty("title").GetString());
        Assert.Empty(Structured(search).GetProperty("items").EnumerateArray());
        Assert.Contains("already exists", Text(retry), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Update_StaleVersion_IsVersionConflictWithTheCurrentVersion_AndSavesNothing()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));
        var id = await CreateAsync(client, "Concurrency");
        await client.CallToolAsync("board_update_item", Args(("id", id), ("version", 1), ("title", "Edited by someone")));

        var stale = await client.CallToolAsync("board_update_item", Args(("id", id), ("version", 1), ("title", "My edit")));
        var current = await client.CallToolAsync("board_get_item", Args(("id", id)));

        Assert.True(stale.IsError);
        Assert.Equal(("version_conflict", 2), (Code(stale), Structured(stale).GetProperty("currentVersion").GetInt32()));
        Assert.Equal("Edited by someone", Item(current).GetProperty("title").GetString());
    }

    [Fact]
    public async Task WriteTool_ReadKey_IsAForbiddenToolError_AndWritesNothing()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Read));
        var title = BoardTestKit.Unique("never-written");

        var result = await client.CallToolAsync("board_create_item", Args(("type", "task"), ("topic", "product"), ("title", title), ("side", "owner")));
        var search = await client.CallToolAsync("board_search", Args(("q", title)));

        Assert.True(result.IsError);
        Assert.Equal("forbidden", Code(result));
        Assert.Contains("insufficient_scope", Structured(result).GetProperty("message").GetString(), StringComparison.Ordinal);
        Assert.Empty(Structured(search).GetProperty("items").EnumerateArray());
    }

    [Fact]
    public async Task WriteTool_KeycloakReader_IsForbidden()
    {
        await using var client = await host.ClientAsync(host.UserToken(TestUsers.NewSubject(), "lotties-board-reader"));

        var result = await client.CallToolAsync("board_delete_item", Args(("id", Guid.NewGuid().ToString())));

        Assert.Equal((true, "forbidden"), (result.IsError, Code(result)));
    }

    [Fact]
    public async Task KeyLimitedToTopics_WritingElsewhere_IsForbidden_ReadingElsewhereIsNotFound()
    {
        await using var writer = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));
        var elsewhere = await CreateAsync(writer, "Outside the key's topics", topic: "design-ux");
        await using var limited = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write, topics: ["product"]));

        var create = await limited.CallToolAsync("board_create_item", Args(("type", "task"), ("topic", "design-ux"), ("title", "Nope"), ("side", "owner")));
        var read = await limited.CallToolAsync("board_get_item", Args(("id", elsewhere)));
        var topics = await limited.CallToolAsync("board_list_topics", Args());

        Assert.Equal(("forbidden", "board_topic_not_allowed"), (Code(create), Structured(create).GetProperty("reason").GetString()));
        Assert.Equal("not_found", Code(read));
        Assert.Equal(["product"], Structured(topics).GetProperty("topics").EnumerateArray().Select(topic => topic.GetProperty("key").GetString()));
    }

    [Theory]
    [InlineData("board_create_item", """{"type":"task","topic":"product","title":"x","side":"owner","id":"6f3c2b1e-9a54-5d7e-8c21-4b0e7d9a1f35"}""", "id")]
    [InlineData("board_create_item", """{"type":"task","topic":"product","title":"x"}""", "side")]
    [InlineData("board_create_item", """{"type":"task","topic":"product","title":"   ","side":"owner"}""", "title")]
    [InlineData("board_create_item", """{"type":"chore","topic":"product","title":"x","side":"owner"}""", "type")]
    [InlineData("board_create_item", """{"type":"task","topic":"no-such-topic","title":"x","side":"owner"}""", "topic")]
    [InlineData("board_create_item", """{"type":"task","topic":"product","title":"x","side":"owner","labels":"one"}""", "labels")]
    [InlineData("board_create_item", """{"type":"task","topic":"product","title":"x","side":"owner","labels":["Not Valid"]}""", "labels")]
    [InlineData("board_create_item", """{"type":"task","topic":"product","title":"x","side":"owner","links":[{"label":"x","url":"ftp://a"}]}""", "links")]
    [InlineData("board_create_item", """{"type":"task","topic":"product","title":"x","side":"owner","dueDate":"24/10/2026"}""", "dueDate")]
    [InlineData("board_create_item", """{"type":"task","topic":"product","title":"x","side":"owner","pinned":true}""", "pinned")]
    [InlineData("board_update_item", """{"id":"6f3c2b1e-9a54-5d7e-8c21-4b0e7d9a1f35","title":"x"}""", "version")]
    [InlineData("board_update_item", """{"id":"6f3c2b1e-9a54-5d7e-8c21-4b0e7d9a1f35","version":"1"}""", "version")]
    [InlineData("board_update_item", """{"id":"not-a-uuid","version":1}""", "id")]
    [InlineData("board_add_comment", """{"id":"6f3c2b1e-9a54-5d7e-8c21-4b0e7d9a1f35","text":""}""", "text")]
    [InlineData("board_list_items", """{"limit":51}""", "limit")]
    [InlineData("board_list_items", """{"status":["open","sleeping"]}""", "status")]
    [InlineData("board_list_items", """{"cursor":"garbage"}""", "cursor")]
    [InlineData("board_list_items", """{"updatedSince":"yesterday"}""", "updatedSince")]
    [InlineData("board_search", """{"q":" "}""", "q")]
    [InlineData("board_recent_changes", """{}""", "since")]
    [InlineData("board_summary", """{"top":21}""", "top")]
    [InlineData("board_record_decision", """{"topic":"product","title":"x","decisionSummary":"y","rationale":"z","relatedItemId":"6f3c2b1e-9a54-5d7e-8c21-4b0e7d9a1f35"}""", "relatedItemId")]
    public async Task Call_InvalidArguments_IsValidationFailedNamingTheArgument(string tool, string arguments, string field)
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));

        var result = await client.CallToolAsync(new CallToolRequestParams { Name = tool, Arguments = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(arguments) });

        Assert.True(result.IsError);
        Assert.Equal(("validation_failed", field), (Code(result), Structured(result).GetProperty("field").GetString()));
    }

    [Fact]
    public async Task UnknownItem_IsNotFound_DeletedItemIsGoneForAKey_AndCannotBeEdited()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));
        var id = await CreateAsync(client, "To delete");

        var unknown = await client.CallToolAsync("board_get_item", Args(("id", Guid.NewGuid().ToString())));
        var deleted = await client.CallToolAsync("board_delete_item", Args(("id", id)));
        var again = await client.CallToolAsync("board_delete_item", Args(("id", id)));
        var read = await client.CallToolAsync("board_get_item", Args(("id", id)));
        var edit = await client.CallToolAsync("board_add_comment", Args(("id", id), ("text", "Too late")));

        Assert.Equal((true, "not_found"), (unknown.IsError, Code(unknown)));
        Assert.Equal((false, true), (deleted.IsError ?? false, Structured(deleted).GetProperty("deleted").GetBoolean()));
        Assert.NotEqual(true, again.IsError);
        Assert.Equal("not_found", Code(read));
        Assert.Equal(("conflict", "board_item_deleted"), (Code(edit), Structured(edit).GetProperty("reason").GetString()));
    }

    [Theory]
    [InlineData("board_get_item", "{}")]
    [InlineData("board_update_item", """{"version":1,"title":"x"}""")]
    [InlineData("board_set_status", """{"status":"done"}""")]
    [InlineData("board_add_comment", """{"text":"x"}""")]
    [InlineData("board_delete_item", "{}")]
    public async Task ItemTools_UnknownId_AreNotFound(string tool, string arguments)
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));
        var withId = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(arguments)!;
        withId["id"] = JsonSerializer.SerializeToElement(Guid.NewGuid().ToString());

        var result = await client.CallToolAsync(new CallToolRequestParams { Name = tool, Arguments = withId });

        Assert.Equal((true, "not_found", "board_item_not_found"), (result.IsError, Code(result), Structured(result).GetProperty("reason").GetString()));
    }

    [Fact]
    public async Task RecordDecision_CreatesADoneDecisionDecidedNow_AndPointsTheRelatedItemToIt()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));
        var question = await CreateAsync(client, "Which store first?", type: "question");
        var before = DateTimeOffset.UtcNow.AddSeconds(-5);

        var result = await client.CallToolAsync("board_record_decision", Args(("topic", "mobile-stores"), ("title", "Android first"), ("decisionSummary", "Ship Android before iOS"), ("rationale", "Cheaper review"), ("source", "conversation 2026-10-24"), ("relatedItemId", question)));
        var related = await client.CallToolAsync("board_get_item", Args(("id", question)));

        Assert.NotEqual(true, result.IsError);
        var decision = Item(result);
        Assert.Equal(("decision", "done", "Ship Android before iOS", "Cheaper review"), (decision.GetProperty("type").GetString(), decision.GetProperty("status").GetString(), decision.GetProperty("decision").GetProperty("summary").GetString(), decision.GetProperty("decision").GetProperty("rationale").GetString()));
        Assert.True(decision.GetProperty("decision").GetProperty("decidedAt").GetDateTimeOffset() >= before);
        Assert.Contains(question, decision.GetProperty("body").GetString(), StringComparison.Ordinal);
        var lastEntry = Structured(related).GetProperty("history").EnumerateArray().Last();
        Assert.Equal("commented", lastEntry.GetProperty("kind").GetString());
        Assert.Contains(decision.GetProperty("id").GetString()!, lastEntry.GetProperty("comment").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task ReadTools_SummaryTopicsListSearchRecentChanges_AnswerTheBoard()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));
        var marker = BoardTestKit.Unique("readtools");
        var since = DateTimeOffset.UtcNow.AddSeconds(-1);
        for (var index = 0; index < 3; index++)
        {
            await client.CallToolAsync("board_create_item", Args(("type", "risk"), ("topic", "infrastructure-deploy"), ("title", $"{marker} {index}"), ("side", "owner"), ("priority", "urgent")));
        }

        var summary = await client.CallToolAsync("board_summary", Args(("top", 2)));
        var topics = await client.CallToolAsync("board_list_topics", Args(("includeArchived", true)));
        var firstPage = await client.CallToolAsync("board_list_items", Args(("q", marker), ("status", new[] { "open", "blocked" }), ("side", "owner"), ("type", "risk"), ("limit", 2)));
        var secondPage = await client.CallToolAsync("board_list_items", Args(("q", marker), ("status", new[] { "open", "blocked" }), ("side", "owner"), ("type", "risk"), ("limit", 2), ("cursor", Structured(firstPage).GetProperty("nextCursor").GetString())));
        var search = await client.CallToolAsync("board_search", Args(("q", marker), ("topic", "infrastructure-deploy"), ("limit", 5)));
        var recent = await client.CallToolAsync("board_recent_changes", Args(("since", since.ToString("O")), ("limit", 50)));

        Assert.True(Structured(summary).GetProperty("totals").GetProperty("waitingOnOwner").GetInt32() >= 3);
        Assert.Equal(2, Structured(summary).GetProperty("waitingOnOwner").GetArrayLength());
        Assert.Contains("waiting on the owner", Text(summary), StringComparison.Ordinal);
        Assert.Contains(Structured(topics).GetProperty("topics").EnumerateArray(), topic => topic.GetProperty("key").GetString() == "product");
        Assert.Equal((2, 1), (Structured(firstPage).GetProperty("items").GetArrayLength(), Structured(secondPage).GetProperty("items").GetArrayLength()));
        Assert.False(Structured(secondPage).TryGetProperty("nextCursor", out _));
        Assert.All(Structured(firstPage).GetProperty("items").EnumerateArray(), item => Assert.False(item.TryGetProperty("body", out _)));
        Assert.Equal(3, Structured(search).GetProperty("items").GetArrayLength());
        Assert.True(Structured(recent).GetProperty("items").GetArrayLength() >= 3);
        Assert.True(Structured(recent).TryGetProperty("since", out _));
    }

    [Fact]
    public async Task UnknownTool_IncludingABabyTool_IsAProtocolError()
    {
        await using var client = await host.ClientAsync(await host.KeyAsync(BoardKeyScope.Write));

        var baby = await Assert.ThrowsAsync<McpProtocolException>(async () => await client.CallToolAsync("log_diaper", Args(("kind", "wet"))));
        var admin = await Assert.ThrowsAsync<McpProtocolException>(async () => await client.CallToolAsync("board_restore_item", Args(("id", Guid.NewGuid().ToString()))));

        Assert.Equal((McpErrorCode.InvalidParams, McpErrorCode.InvalidParams), (baby.ErrorCode, admin.ErrorCode));
    }

    internal static Dictionary<string, object?> Args(params (string Name, object? Value)[] arguments) =>
        arguments.ToDictionary(argument => argument.Name, argument => argument.Value);

    internal static JsonElement Structured(CallToolResult result) => result.StructuredContent!.Value;

    internal static JsonElement Item(CallToolResult result) => Structured(result).GetProperty("item");

    internal static string Code(CallToolResult result) => Structured(result).GetProperty("code").GetString()!;

    internal static string Text(CallToolResult result) => ((TextContentBlock)result.Content[0]).Text;

    private static IEnumerable<string> Required(IEnumerable<Tool> tools, string name) =>
        tools.Single(tool => tool.Name == name).InputSchema.GetProperty("required").EnumerateArray().Select(value => value.GetString()!);

    private static async Task<string> CreateAsync(McpClient client, string title, string topic = "product", string type = "task")
    {
        var created = await client.CallToolAsync("board_create_item", Args(("type", type), ("topic", topic), ("title", title), ("side", "assistant")));
        Assert.NotEqual(true, created.IsError);
        return Item(created).GetProperty("id").GetString()!;
    }
}
