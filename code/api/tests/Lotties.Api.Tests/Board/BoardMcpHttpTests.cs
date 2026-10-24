using System.Net;
using System.Text;
using Lotties.Api.Board;
using Lotties.Api.Board.Mcp;
using Lotties.Api.Tests.Assistants;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Board;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using static Lotties.Api.Tests.Board.BoardMcpProtocolTests;

namespace Lotties.Api.Tests.Board;

/// <summary>
/// The board's MCP endpoint at the HTTP level: authentication (no credentials, bad, revoked and expired keys, invalid
/// tokens, a user without a board role), the separation from the baby-data MCP endpoint in both directions, the flags (404),
/// origin validation, the body limit, the board rate limit (a tool error for a tool call), 405 for GET and DELETE, and logs
/// without arguments, item contents or keys.
/// </summary>
public sealed class BoardMcpHttpTests(BoardMcpHost host) : IClassFixture<BoardMcpHost>
{
    [Fact]
    public async Task NoCredentials_Is401WithABearerChallenge()
    {
        var response = await host.PostAsync(bearer: null, BoardMcpMessages.Initialize());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.StartsWith("Bearer", response.Headers.WwwAuthenticate.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("unknown")]
    [InlineData("revoked")]
    [InlineData("expired")]
    [InlineData("malformed")]
    public async Task InvalidKey_Is401InvalidToken_InEitherHeader(string flaw)
    {
        var secret = flaw switch
        {
            "revoked" => await host.KeyAsync(BoardKeyScope.Write, revoked: true),
            "expired" => await host.KeyAsync(BoardKeyScope.Write, expired: true),
            "malformed" => "lbk_short",
            _ => "lbk_" + new string('A', 43),
        };

        var bearer = await host.PostAsync(secret, BoardMcpMessages.Initialize());
        var header = await host.PostAsync(secret, BoardMcpMessages.Initialize(), inBoardKeyHeader: true);

        Assert.Equal((HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized), (bearer.StatusCode, header.StatusCode));
        Assert.Equal("Bearer error=\"invalid_token\"", bearer.Headers.WwwAuthenticate.ToString());
        Assert.Contains("invalid_board_key", await bearer.Content.ReadAsStringAsync(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("expired")]
    [InlineData("not-a-jwt")]
    public async Task InvalidUserToken_Is401(string flaw)
    {
        var token = flaw == "expired"
            ? host.UserToken(TestUsers.NewSubject(), "lotties-board-writer", expires: DateTimeOffset.UtcNow.AddMinutes(-10))
            : "not-a-jwt";

        var response = await host.PostAsync(token, BoardMcpMessages.Initialize());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.StartsWith("Bearer", response.Headers.WwwAuthenticate.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task UserWithoutABoardRole_Is403()
    {
        var response = await host.PostAsync(host.UserToken(TestUsers.NewSubject(), "offline_access"), BoardMcpMessages.Initialize());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task ValidKey_Initializes_Statelessly()
    {
        var response = await host.PostAsync(await host.KeyAsync(BoardKeyScope.Read), BoardMcpMessages.Initialize());
        var message = await BoardMcpHost.MessageOf(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(response.Headers.Contains("Mcp-Session-Id"));
        Assert.Equal("lotties-board", message.GetProperty("result").GetProperty("serverInfo").GetProperty("name").GetString());
    }

    [Fact]
    public async Task BoardKey_NeverReachesTheBabyMcpEndpoint()
    {
        var secret = await host.KeyAsync(BoardKeyScope.Write);

        var bearer = await host.PostAsync(secret, McpMessages.ListTools(), BoardMcpHost.BabyMcpPath);
        var header = await host.PostAsync(secret, McpMessages.ListTools(), BoardMcpHost.BabyMcpPath, inBoardKeyHeader: true);

        Assert.Equal((HttpStatusCode.Unauthorized, HttpStatusCode.Unauthorized), (bearer.StatusCode, header.StatusCode));
    }

    [Fact]
    public async Task BabyMcpToken_NeverReachesTheBoardEndpoint_EvenWithABoardRole()
    {
        var babyToken = host.UserToken(TestUsers.NewSubject(), "lotties-board-admin", audience: BoardMcpMessages.BabyAudience, scope: BoardMcpMessages.BabyReadScope);

        var board = await host.PostAsync(babyToken, BoardMcpMessages.ListTools());
        var baby = await host.PostAsync(babyToken, McpMessages.Initialize(), BoardMcpHost.BabyMcpPath);

        Assert.Equal(HttpStatusCode.Unauthorized, board.StatusCode);
        Assert.Equal(HttpStatusCode.OK, baby.StatusCode);
    }

    [Fact]
    public async Task BabyEndpoint_ListsOnlyBabyTools_BoardEndpointOnlyBoardTools()
    {
        var babyToken = host.UserToken(TestUsers.NewSubject(), roles: null, audience: BoardMcpMessages.BabyAudience, scope: "lotties.read lotties.write");
        var writeKey = await host.KeyAsync(BoardKeyScope.Write);

        var babyTools = await BoardMcpHost.MessageOf(await host.PostAsync(babyToken, McpMessages.ListTools(), BoardMcpHost.BabyMcpPath));
        var boardTools = await BoardMcpHost.MessageOf(await host.PostAsync(writeKey, BoardMcpMessages.ListTools()));

        Assert.DoesNotContain(Names(babyTools), name => name.StartsWith("board_", StringComparison.Ordinal));
        Assert.All(Names(boardTools), name => Assert.StartsWith("board_", name, StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("POST", "false", "true")]
    [InlineData("POST", "true", "false")]
    [InlineData("GET", "true", "false")]
    [InlineData("DELETE", "true", "false")]
    public async Task Disabled_EveryRouteIs404_EvenWithAValidKey(string method, string mcpEnabled, string boardEnabled)
    {
        using var disabled = BoardMcpHost.With(("Board:Mcp:Enabled", mcpEnabled), ("Board:Enabled", boardEnabled));
        var request = new HttpRequestMessage(new HttpMethod(method), BoardMcpHost.Path);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "lbk_" + new string('A', 43));
        if (method == "POST")
        {
            request.Content = new StringContent(BoardMcpMessages.Initialize(), Encoding.UTF8, "application/json");
        }

        var response = await disabled.HttpFor(bearer: null).SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public void Options_DefaultsAreOff() =>
        Assert.Equal((false, false, 0), (new BoardOptions().Enabled, new BoardOptions().Mcp.Enabled, new BoardOptions().Mcp.AllowedOrigins.Count));

    [Theory]
    [InlineData("https://inspector.example", true)]
    [InlineData("not an origin", false)]
    [InlineData("ftp://files.example", false)]
    public void Options_AllowedOriginsAreValidatedAtStartup(string origin, bool valid)
    {
        var options = new BoardOptions { Mcp = new BoardMcpOptions { AllowedOrigins = [origin] } };

        var result = new BoardMcpOptionsValidator().Validate(null, options);

        Assert.Equal(valid, result.Succeeded);
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("DELETE")]
    public async Task GetAndDelete_Are405AllowingPost(string method)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), BoardMcpHost.Path);

        var response = await host.HttpFor(await host.KeyAsync(BoardKeyScope.Read)).SendAsync(request);

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
        Assert.Equal(["POST"], response.Content.Headers.Allow);
    }

    [Fact]
    public async Task ForeignOrigin_Is403_NoOriginPasses_AnAllowedOriginPasses()
    {
        using var allowing = BoardMcpHost.With(("Board:Mcp:AllowedOrigins", "https://inspector.example"));
        var secret = await allowing.KeyAsync(BoardKeyScope.Read);

        var foreign = await allowing.PostAsync(secret, BoardMcpMessages.Initialize(), headers: [("Origin", "https://evil.example")]);
        var serverSide = await allowing.PostAsync(secret, BoardMcpMessages.Initialize());
        var allowed = await allowing.PostAsync(secret, BoardMcpMessages.Initialize(), headers: [("Origin", "https://inspector.example")]);

        Assert.Equal((HttpStatusCode.Forbidden, HttpStatusCode.OK, HttpStatusCode.OK), (foreign.StatusCode, serverSide.StatusCode, allowed.StatusCode));
        Assert.Equal("https://inspector.example", allowed.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task BodyOverTheBoardLimit_Is413_AndWritesNothing()
    {
        var secret = await host.KeyAsync(BoardKeyScope.Write);
        var title = BoardTestKit.Unique("too-large");
        var body = new string('a', 300 * 1024);

        var response = await host.PostAsync(secret, BoardMcpMessages.Call("board_create_item", $$"""{"type":"task","topic":"product","title":"{{title}}","side":"owner","body":"{{body}}"}"""));
        var search = await host.PostAsync(secret, BoardMcpMessages.Call("board_search", $$"""{"q":"{{title}}"}"""));

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Contains("request_body_too_large", await response.Content.ReadAsStringAsync(), StringComparison.Ordinal);
        Assert.Equal(0, (await BoardMcpHost.MessageOf(search)).GetProperty("result").GetProperty("structuredContent").GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task OverTheBoardLimit_AToolCallIsARateLimitedToolError_OtherMessagesA429()
    {
        using var limited = BoardMcpHost.With(("RequestLimits:BoardPermitsPerMinute", "2"));
        var secret = await limited.KeyAsync(BoardKeyScope.Write);
        var title = BoardTestKit.Unique("limited");

        await limited.PostAsync(secret, BoardMcpMessages.Call("board_summary"));
        await limited.PostAsync(secret, BoardMcpMessages.Call("board_summary"));
        var call = await limited.PostAsync(secret, BoardMcpMessages.Call("board_create_item", $$"""{"type":"task","topic":"product","title":"{{title}}","side":"owner"}""", id: 42));
        var list = await limited.PostAsync(secret, BoardMcpMessages.ListTools());
        var readKey = await limited.KeyAsync(BoardKeyScope.Read);
        var otherKey = await limited.PostAsync(readKey, BoardMcpMessages.Call("board_search", $$"""{"q":"{{title}}"}"""));

        Assert.Equal(HttpStatusCode.OK, call.StatusCode);
        var message = await BoardMcpHost.MessageOf(call);
        var result = message.GetProperty("result");
        Assert.Equal(42, message.GetProperty("id").GetInt32());
        Assert.True(result.GetProperty("isError").GetBoolean());
        Assert.Equal("rate_limited", result.GetProperty("structuredContent").GetProperty("code").GetString());
        Assert.True(call.Headers.Contains("Retry-After"));
        Assert.Equal(HttpStatusCode.TooManyRequests, list.StatusCode);
        Assert.Equal(HttpStatusCode.OK, otherKey.StatusCode);
        Assert.Equal(0, (await BoardMcpHost.MessageOf(otherKey)).GetProperty("result").GetProperty("structuredContent").GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task ToolCalls_LogOnlyTheToolNameCodeAndCorrelation_NeverArgumentsContentsOrKeys()
    {
        var logs = new CapturingLoggerProvider();
        using var capturing = BoardMcpHost.WithServices(services => services.AddSingleton<Microsoft.Extensions.Logging.ILoggerProvider>(logs));
        var secret = await capturing.KeyAsync(BoardKeyScope.Write);
        const string title = "Secret-ish title 7781";
        const string body = "Body text 9932 that must stay out of logs";

        var created = await capturing.PostAsync(secret, BoardMcpMessages.Call("board_create_item", $$"""{"type":"task","topic":"product","title":"{{title}}","side":"owner","body":"{{body}}","externalKey":"ext-key-5521"}"""));
        var refused = await capturing.PostAsync(secret, BoardMcpMessages.Call("board_create_item", """{"type":"task","topic":"product","title":"x","side":"owner","note":"stray 4410"}"""));

        var listed = await capturing.PostAsync(secret, BoardMcpMessages.Call("board_list_items", """{"label":"lbl6621","q":"query5150","topic":"product"}"""));

        Assert.Equal((HttpStatusCode.OK, HttpStatusCode.OK, HttpStatusCode.OK), (created.StatusCode, refused.StatusCode, listed.StatusCode));
        var lines = logs.Messages;
        Assert.Contains(lines, line => line.StartsWith("Board MCP board_create_item: ok (correlation ", StringComparison.Ordinal));
        Assert.Contains(lines, line => line.StartsWith("Board MCP board_create_item: validation_failed (correlation ", StringComparison.Ordinal));
        Assert.Equal(string.Empty, string.Join(" ---- ", lines.Where(line =>
            line.Contains("7781", StringComparison.Ordinal)
            || line.Contains("9932", StringComparison.Ordinal)
            || line.Contains("ext-key-5521", StringComparison.Ordinal)
            || line.Contains("4410", StringComparison.Ordinal)
            || line.Contains("6621", StringComparison.Ordinal)
            || line.Contains("5150", StringComparison.Ordinal)
            || line.Contains(secret, StringComparison.Ordinal)
            || line.Contains(secret[..12], StringComparison.Ordinal))));
    }

    [Fact]
    public void BoardMcpPath_IsUnderTheBoardRoutes() =>
        Assert.Equal("/api/v1/board/mcp", BoardMcpServer.Path);

    private static IEnumerable<string> Names(System.Text.Json.JsonElement listToolsMessage) =>
        listToolsMessage.GetProperty("result").GetProperty("tools").EnumerateArray().Select(tool => tool.GetProperty("name").GetString()!);
}
