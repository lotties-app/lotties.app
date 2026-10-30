using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Lotties.Application.Board;
using Lotties.Domain.Exceptions;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Lotties.Api.Board.Mcp;

/// <summary>
/// The board's MCP adapter (docs/design/36-project-board.md section 9): <c>tools/list</c> shows the tools the caller's board
/// permissions open (a read key or the reader role: read tools; a write key, the writer or the admin role: also the write
/// tools); <c>tools/call</c> checks the permission again, the arguments' shape (strict), then runs the same
/// <see cref="IBoardService"/> calls as the REST routes as the request's caller (the key or the user), so the history names
/// the key or the person. Logs: tool name, result code and correlation id only; never arguments, item contents or keys.
/// </summary>
internal sealed class BoardMcpToolRunner(IBoardService board, IHttpContextAccessor httpContextAccessor, ILogger<BoardMcpToolRunner> logger)
{
    public static ValueTask<ListToolsResult> ListToolsAsync(RequestContext<ListToolsRequestParams> request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var allowed = BoardMcpToolCatalog.AllowedFor(BoardClaims.AccessOf(request.User));
        return ValueTask.FromResult(new ListToolsResult { Tools = allowed.Select(tool => tool.Definition()).ToList() });
    }

    public static async ValueTask<CallToolResult> CallToolAsync(RequestContext<CallToolRequestParams> request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var services = request.Services ?? throw new InvalidOperationException("The MCP request has no service provider.");
        var runner = services.GetRequiredService<BoardMcpToolRunner>();
        return await runner.CallAsync(request.Params, request.User, cancellationToken);
    }

    public async Task<CallToolResult> CallAsync(CallToolRequestParams? call, ClaimsPrincipal? user, CancellationToken cancellationToken)
    {
        var tool = BoardMcpToolCatalog.Find(call?.Name) ?? throw new McpProtocolException("Unknown tool.", McpErrorCode.InvalidParams);
        var (code, result) = await RunAsync(tool, call!, user, cancellationToken);
        logger.LogInformation("Board MCP {Tool}: {Outcome} (correlation {CorrelationId})", tool.Name, code, httpContextAccessor.HttpContext?.TraceIdentifier);
        return result;
    }

    private async Task<(string Code, CallToolResult Result)> RunAsync(BoardMcpTool tool, CallToolRequestParams call, ClaimsPrincipal? user, CancellationToken cancellationToken)
    {
        var access = BoardClaims.AccessOf(user);
        if (!(tool.Writes ? access.CanWrite : access.CanRead))
        {
            var needs = tool.Writes
                ? "This tool writes: it needs a board API key with the write scope or the lotties-board-writer role (insufficient_scope)."
                : "This tool needs board read access.";
            return Failed(BoardMcpToolResults.Forbidden, needs);
        }

        var (arguments, error) = BoardMcpArguments.Parse(call.Arguments, tool.Parameters);
        if (error is not null)
        {
            return Failed(BoardMcpToolResults.ValidationFailed, error.Message, new JsonObject { ["field"] = error.Field });
        }

        try
        {
            var outcome = await tool.Run(board, arguments!, cancellationToken);
            return (BoardMcpToolResults.Ok, BoardMcpToolResults.Success(outcome));
        }
        catch (DomainException exception)
        {
            var (code, extra) = BoardMcpToolResults.Classify(exception, tool);
            return Failed(code, exception.Message, extra);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "Board MCP {Tool} failed (correlation {CorrelationId})", tool.Name, httpContextAccessor.HttpContext?.TraceIdentifier);
            return Failed(BoardMcpToolResults.InternalError, "Something went wrong. Try again later.");
        }
    }

    private static (string Code, CallToolResult Result) Failed(string code, string message, JsonObject? extra = null) =>
        (code, BoardMcpToolResults.Error(code, message, extra));
}

/// <summary>
/// Renders board tool outcomes for MCP clients: <c>structuredContent</c> is the REST JSON shape (camelCase, codes snake_case,
/// instants UTC, null members left out), and <c>content</c> holds a short sentence plus the same JSON as text (for clients
/// that read only text). Failures are tool errors (<c>isError: true</c>) with a typed <c>code</c>
/// (<see cref="NotFound"/>, <see cref="VersionConflict"/> with <c>currentVersion</c>, <see cref="ValidationFailed"/> with
/// <c>field</c>, <see cref="Forbidden"/>, <see cref="Conflict"/>, <see cref="RateLimited"/>), the domain's own code as
/// <c>reason</c> when it says more; never a stack trace or exception text of an unexpected error.
/// </summary>
internal static class BoardMcpToolResults
{
    public const string Ok = "ok";
    public const string NotFound = "not_found";
    public const string VersionConflict = "version_conflict";
    public const string ValidationFailed = "validation_failed";
    public const string Forbidden = "forbidden";
    public const string Conflict = "conflict";
    public const string RateLimited = "rate_limited";
    public const string Rejected = "rejected";
    public const string InternalError = "internal_error";

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static CallToolResult Success(BoardMcpOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);
        return Build(outcome.Sentence, outcome.Structured, isError: false);
    }

    /// <summary>A tool error: <c>{code, message, ...extra}</c>.</summary>
    public static CallToolResult Error(string code, string message, JsonObject? extra = null)
    {
        var structured = new JsonObject { ["code"] = code, ["message"] = message };
        foreach (var (name, value) in extra ?? [])
        {
            structured[name] = value?.DeepClone();
        }

        return Build($"{code}: {message}", structured, isError: true);
    }

    /// <summary>The tool error code of a refusal of the board service, and its extra members.</summary>
    public static (string Code, JsonObject Extra) Classify(DomainException exception, BoardMcpTool tool)
    {
        ArgumentNullException.ThrowIfNull(exception);
        ArgumentNullException.ThrowIfNull(tool);
        return exception switch
        {
            DomainValidationException validation => (ValidationFailed, new JsonObject { ["field"] = tool.ArgumentOf(validation.Field) }),
            InvalidBoardCursorException => (ValidationFailed, new JsonObject { ["field"] = "cursor", ["reason"] = exception.Code }),
            BoardUnknownTopicException or BoardTopicArchivedException => (ValidationFailed, new JsonObject { ["field"] = "topic", ["reason"] = exception.Code }),
            BoardItemNotFoundException => (NotFound, new JsonObject { ["reason"] = exception.Code }),
            BoardVersionMismatchException mismatch => (VersionConflict, new JsonObject { ["currentVersion"] = mismatch.CurrentVersion, ["reason"] = exception.Code }),
            BoardTopicNotAllowedException or BoardAdminRequiredException => (Forbidden, new JsonObject { ["reason"] = exception.Code }),
            BoardItemDeletedException or ConcurrentModificationException => (Conflict, new JsonObject { ["reason"] = exception.Code }),
            _ => (Rejected, new JsonObject { ["reason"] = exception.Code }),
        };
    }

    private static CallToolResult Build(string sentence, JsonObject structured, bool isError) => new()
    {
        Content = [new TextContentBlock { Text = sentence }, new TextContentBlock { Text = structured.ToJsonString(Json) }],
        StructuredContent = JsonSerializer.SerializeToElement(structured, Json),
        IsError = isError,
    };
}
