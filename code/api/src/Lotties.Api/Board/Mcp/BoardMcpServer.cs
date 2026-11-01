using System.Globalization;
using System.Text.Json;
using System.Threading.RateLimiting;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Consents;
using Lotties.Api.Endpoints;
using Lotties.Api.Limits;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using ModelContextProtocol;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Lotties.Api.Board.Mcp;

/// <summary>
/// Endpoint metadata: the route belongs to the board's MCP endpoint: the message endpoint itself (<c>POST</c>), or its 405
/// answers to <c>GET</c> and <c>DELETE</c>.
/// </summary>
internal sealed class BoardMcpEndpointMetadata
{
    private BoardMcpEndpointMetadata(bool isEndpoint) => IsEndpoint = isEndpoint;

    public static BoardMcpEndpointMetadata Endpoint { get; } = new(isEndpoint: true);

    public static BoardMcpEndpointMetadata Other { get; } = new(isEndpoint: false);

    public bool IsEndpoint { get; }
}

/// <summary>
/// The project board's MCP endpoint (docs/design/36-project-board.md section 9): <c>POST /api/v1/board/mcp</c>, Streamable
/// HTTP, stateless, on the same official SDK server registration as the baby-data MCP endpoint (one SDK per process) but a
/// separate server to its clients: its own route, name, instructions and tool list, chosen per request
/// (<see cref="HttpServerTransportOptions.ConfigureSessionOptions"/>), so a board caller never sees a baby tool and a baby
/// MCP token never reaches a board tool. Authentication and authorization are the board's (a board API key through the
/// board guard, or the API's own Keycloak token with a board realm role; policy <see cref="BoardPolicies.Read"/>), with the
/// board's rate limit (per key or per user, shared with the REST routes) and body limit.
/// </summary>
public static class BoardMcpServer
{
    public const string Path = ApiEndpoints.V1Prefix + BoardEndpoints.Prefix + "/mcp";

    /// <summary>The CORS policy of the endpoint: only <see cref="BoardMcpOptions.AllowedOrigins"/> (none by default).</summary>
    public const string CorsPolicy = "board-mcp-endpoint";

    private const string Instructions =
        "The Lotties project board: the internal list of tasks, gaps, decisions, open questions, risks, notes and memories that " +
        "the project owner and the AI assistant keep together, by topic, with who acts next (side: owner, assistant, both, " +
        "external). It never holds a baby's or a family's data. Start with board_summary; list or search items without bodies, " +
        "then board_get_item for one item, its version and history. To change an item pass the version you read " +
        "(board_update_item); on version_conflict read it again. Pass an externalKey to board_create_item so a retry never " +
        "creates a duplicate. Instants are UTC (ISO 8601).";

    /// <summary>
    /// Validates <c>Board:Mcp</c> at startup, adds the endpoint's CORS policy, the tool runner, the per-request choice of the
    /// board server (name, instructions, tool handlers) on the board route, and the rate-limit answer of the board route (a
    /// <c>tools/call</c> over the limit is a <c>rate_limited</c> tool error). Needs <see cref="McpServiceCollectionExtensions.AddMcpAdapter"/>
    /// (the SDK registration) and <see cref="BoardServiceCollectionExtensions.AddProjectBoard"/>.
    /// </summary>
    public static IServiceCollection AddBoardMcp(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<BoardOptions>().ValidateOnStart();
        services.AddSingleton<IValidateOptions<BoardOptions>, BoardMcpOptionsValidator>();
        services.AddSingleton<IPostConfigureOptions<BoardOptions>>(new BoardMcpAllowedOriginsFromText(configuration));
        services.AddOptions<CorsOptions>().Configure<IOptions<BoardOptions>>(AddCorsPolicy);
        services.AddScoped<BoardMcpToolRunner>();
        services.PostConfigure<HttpServerTransportOptions>(ChooseServerPerRoute);
        services.AddOptions<RateLimiterOptions>().PostConfigure<IOptions<RequestLimitsOptions>>(
            (rateLimiter, limits) => BoardMcpRateLimit.Decorate(rateLimiter, limits.Value.BoardMaxRequestBodyBytes));
        return services;
    }

    /// <summary>
    /// Maps <c>POST /api/v1/board/mcp</c> (policy <see cref="BoardPolicies.Read"/>, the board rate limit and body limit) and its
    /// 405 answers to <c>GET</c> and <c>DELETE</c>. Every route is 404 unless both <c>Board:Enabled</c> and
    /// <c>Board:Mcp:Enabled</c> (<see cref="BoardMcpRequestGuard"/>, then the board guard).
    /// </summary>
    private const string BoardReason = "The project board is internal project tracking, never baby data (docs/design/36-project-board.md).";

    public static WebApplication MapBoardMcpEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.MapMcp(Path)
            .RequireAuthorization(BoardPolicies.Read)
            .RequireRateLimiting(RequestLimitPolicies.Board)
            .RequireCors(CorsPolicy)
            .AllowWithoutConsent(BoardReason)
            .WithMetadata(BoardMcpEndpointMetadata.Endpoint, BoardEndpointMetadata.Instance, BoardRequestLimitsMetadata.Standard);

        // Stateless Streamable HTTP has no GET stream and no session to DELETE: 405, never a sign-in challenge.
        app.MapMethods(Path, [HttpMethods.Get, HttpMethods.Delete], MethodNotAllowed)
            .AllowAnonymous()
            .RequireCors(CorsPolicy)
            .AllowWithoutConsent(BoardReason)
            .WithMetadata(BoardMcpEndpointMetadata.Other, BoardEndpointMetadata.Instance)
            .ExcludeFromDescription();
        return app;
    }

    /// <summary><see cref="BoardMcpRequestGuard"/>: after authentication, before the board guard.</summary>
    public static IApplicationBuilder UseBoardMcpRequestGuard(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<BoardMcpRequestGuard>();
    }

    /// <summary>Whether the request's endpoint is the board's MCP message endpoint.</summary>
    internal static bool IsBoardMcpEndpoint(HttpContext context) =>
        context.GetEndpoint()?.Metadata.GetMetadata<BoardMcpEndpointMetadata>() is { IsEndpoint: true };

    private static void ChooseServerPerRoute(HttpServerTransportOptions transport)
    {
        var previous = transport.ConfigureSessionOptions;
        transport.ConfigureSessionOptions = async (context, options, cancellationToken) =>
        {
            if (previous is not null)
            {
                await previous(context, options, cancellationToken);
            }

            if (IsBoardMcpEndpoint(context))
            {
                ConfigureBoardServer(options);
            }
        };
    }

    private static void ConfigureBoardServer(McpServerOptions options)
    {
        options.ServerInfo = new Implementation { Name = "lotties-board", Title = "Lotties project board", Version = "1.0.0" };
        options.ServerInstructions = Instructions;
        options.Capabilities = new ServerCapabilities { Tools = new ToolsCapability { ListChanged = false } };
        options.Handlers.ListToolsHandler = BoardMcpToolRunner.ListToolsAsync;
        options.Handlers.CallToolHandler = BoardMcpToolRunner.CallToolAsync;
    }

    private static IResult MethodNotAllowed(HttpContext context)
    {
        context.Response.Headers.Allow = HttpMethods.Post;
        return Results.StatusCode(StatusCodes.Status405MethodNotAllowed);
    }

    private static void AddCorsPolicy(CorsOptions cors, IOptions<BoardOptions> board) =>
        cors.AddPolicy(CorsPolicy, policy => policy
            .WithOrigins(board.Value.Mcp.AllowedOrigins.Select(origin => origin.Trim().TrimEnd('/')).ToArray())
            .AllowAnyHeader()
            .WithMethods(HttpMethods.Post, HttpMethods.Get, HttpMethods.Delete)
            .WithExposedHeaders("WWW-Authenticate", "MCP-Protocol-Version"));
}

/// <summary>
/// Runs right after authentication, before the board guard and the rate limiter, on the board MCP routes only: they answer
/// 404 unless both <c>Board:Enabled</c> and <c>Board:Mcp:Enabled</c> are true (before any 401, so a disabled endpoint looks
/// like no route), and an <c>Origin</c> outside <see cref="BoardMcpOptions.AllowedOrigins"/> is 403 on the endpoint (MCP
/// Streamable HTTP: DNS rebinding protection). The caller's identity is the board guard's (a key) or the API's (a user).
/// </summary>
internal sealed class BoardMcpRequestGuard(RequestDelegate next, IOptionsMonitor<BoardOptions> options, ILogger<BoardMcpRequestGuard> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.GetEndpoint()?.Metadata.GetMetadata<BoardMcpEndpointMetadata>() is not { } route)
        {
            await next(context);
            return;
        }

        var settings = options.CurrentValue;
        if (!settings.Enabled || !settings.Mcp.Enabled)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        if (route.IsEndpoint && context.Request.Headers.Origin.ToString() is { Length: > 0 } origin && !settings.Mcp.AllowsOrigin(origin))
        {
            logger.LogWarning("Board MCP request refused: origin not allowed (correlation {CorrelationId})", context.TraceIdentifier);
            await McpHttpErrors.WriteAsync(context, StatusCodes.Status403Forbidden, "Origin not allowed.");
            return;
        }

        await next(context);
    }
}

/// <summary>
/// The answer of the board MCP endpoint over the board rate limit (the same per-key or per-user window as the REST routes,
/// or the global per-user one): a single <c>tools/call</c> message gets a JSON-RPC result that is a <c>rate_limited</c> tool
/// error (with <c>Retry-After</c>), so the model reads "try again later" instead of a transport failure; anything else
/// (initialize, tools/list, batches, other routes) keeps the API's 429 problem.
/// </summary>
internal static class BoardMcpRateLimit
{
    public static void Decorate(RateLimiterOptions rateLimiter, long maxBodyBytes)
    {
        ArgumentNullException.ThrowIfNull(rateLimiter);
        var inner = rateLimiter.OnRejected;
        rateLimiter.OnRejected = async (rejected, cancellationToken) =>
        {
            if (!await TryAnswerToolCallAsync(rejected, maxBodyBytes, cancellationToken) && inner is not null)
            {
                await inner(rejected, cancellationToken);
            }
        };
    }

    private static async Task<bool> TryAnswerToolCallAsync(OnRejectedContext rejected, long maxBodyBytes, CancellationToken cancellationToken)
    {
        var context = rejected.HttpContext;
        if (!BoardMcpServer.IsBoardMcpEndpoint(context) || !HttpMethods.IsPost(context.Request.Method) || context.Response.HasStarted)
        {
            return false;
        }

        var body = await ReadBoundedAsync(context.Request, maxBodyBytes, cancellationToken);
        if (body is null || ToolCallOf(body) is not { } call)
        {
            return false;
        }

        var retryAfter = rejected.Lease.TryGetMetadata(MetadataName.RetryAfter, out var wait) ? wait : TimeSpan.FromMinutes(1);
        var result = BoardMcpToolResults.Error(BoardMcpToolResults.RateLimited, "Too many board requests; try again in a minute.", new() { ["retryAfterSeconds"] = (int)Math.Ceiling(retryAfter.TotalSeconds) });
        var response = new JsonRpcResponse { Id = call.Id, Result = JsonSerializer.SerializeToNode(result, McpJsonUtilities.DefaultOptions) };
        context.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger(typeof(BoardMcpRateLimit))
            .LogInformation("Board MCP {Tool}: {Outcome} (correlation {CorrelationId})", call.Tool, BoardMcpToolResults.RateLimited, context.TraceIdentifier);
        context.Response.StatusCode = StatusCodes.Status200OK;
        context.Response.Headers.RetryAfter = Math.Ceiling(retryAfter.TotalSeconds).ToString(CultureInfo.InvariantCulture);
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(JsonSerializer.Serialize<JsonRpcMessage>(response, McpJsonUtilities.DefaultOptions), cancellationToken);
        return true;
    }

    /// <summary>The id and the (known) tool name of a single <c>tools/call</c> request, else <c>null</c>.</summary>
    private static (RequestId Id, string Tool)? ToolCallOf(byte[] body)
    {
        try
        {
            if (JsonSerializer.Deserialize<JsonRpcMessage>(body, McpJsonUtilities.DefaultOptions) is not JsonRpcRequest { Method: RequestMethods.ToolsCall } request)
            {
                return null;
            }

            var name = request.Params?["name"]?.GetValue<string>();
            return (request.Id, BoardMcpToolCatalog.Find(name)?.Name ?? "unknown_tool");
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }

    private static async Task<byte[]?> ReadBoundedAsync(HttpRequest request, long maxBytes, CancellationToken cancellationToken)
    {
        if (request.ContentLength > maxBytes)
        {
            return null;
        }

        using var buffer = new MemoryStream();
        var chunk = new byte[8 * 1024];
        int read;
        while ((read = await request.Body.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > maxBytes)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }
}
