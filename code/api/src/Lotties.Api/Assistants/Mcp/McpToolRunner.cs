using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Authentication;
using Lotties.Api.Limits;
using Lotties.Application.Assistants;
using Lotties.Domain.Exceptions;
using ModelContextProtocol;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;

namespace Lotties.Api.Assistants.Mcp;

/// <summary>
/// The MCP adapter of the assistant command layer (docs/design/32-assistants.md section 9): <c>tools/list</c> shows the tools
/// the token's scopes open, <c>tools/call</c> checks the tool's scope (the request gate already answered 403 for a missing
/// one), the user's assistant limit, the arguments (strict), then runs the one <see cref="IAssistantService"/> method as the
/// token's user and renders its result. Logs: tool name, result code and correlation id; never arguments, tokens or ids.
/// </summary>
internal sealed class McpToolRunner(
    IAssistantService assistant,
    AssistantRateLimiter rateLimiter,
    IHttpContextAccessor httpContextAccessor,
    TimeProvider timeProvider,
    ILogger<McpToolRunner> logger)
{
    /// <summary>The adapter's stable name: part of the event ids it writes (never change it).</summary>
    public const string AdapterName = "mcp";

    /// <summary>
    /// The Siri intents send <c>Lotties-Client: siri</c> so what they log is marked as Siri's, not as a generic AI assistant's
    /// (docs/design/32-assistants.md "Origin marker"). Any other value is ignored; the marker also scopes what a Siri
    /// delete request may touch: only entries Siri itself made.
    /// </summary>
    public const string ClientHeader = "Lotties-Client";

    public const string SiriAdapterName = "siri";

    /// <summary>
    /// A client that speaks the answer itself (the iOS Siri intents) sends its locale here and gets the same sentence the
    /// Alexa skill would say in <c>structuredContent.speech</c>; other clients never send it and get nothing extra.
    /// </summary>
    public const string SpeechLocaleHeader = "Lotties-Speech-Locale";

    public static ValueTask<ListToolsResult> ListToolsAsync(RequestContext<ListToolsRequestParams> request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var allowed = McpToolCatalog.AllowedBy(McpScopes.Of(request.User));
        return ValueTask.FromResult(new ListToolsResult { Tools = allowed.Select(tool => tool.Definition()).ToList() });
    }

    public static async ValueTask<CallToolResult> CallToolAsync(RequestContext<CallToolRequestParams> request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var services = request.Services ?? throw new InvalidOperationException("The MCP request has no service provider.");
        var runner = services.GetRequiredService<McpToolRunner>();
        return await runner.CallAsync(request.Params, request.User, cancellationToken);
    }

    public async Task<CallToolResult> CallAsync(CallToolRequestParams? call, ClaimsPrincipal? user, CancellationToken cancellationToken)
    {
        var tool = McpToolCatalog.Find(call?.Name) ?? throw new McpProtocolException("Unknown tool.", McpErrorCode.InvalidParams);
        var outcome = await RunAsync(tool, call!, user, cancellationToken);
        logger.LogInformation("MCP {Tool}: {Outcome} (correlation {CorrelationId})", tool.Name, outcome.Code, httpContextAccessor.HttpContext?.TraceIdentifier);
        return outcome.Result;
    }

    private async Task<(string Code, CallToolResult Result)> RunAsync(McpTool tool, CallToolRequestParams call, ClaimsPrincipal? user, CancellationToken cancellationToken)
    {
        if (!McpScopes.Grants(user, tool.Scope) || user?.FindFirst(OidcClaims.Subject)?.Value is not { Length: > 0 } subject)
        {
            return (McpToolResults.InsufficientScope, McpToolResults.Error(McpToolResults.InsufficientScope, $"This tool needs the {tool.Scope} scope."));
        }

        if (!rateLimiter.TryAcquire(subject))
        {
            return Rendered(new AssistantResult { Code = AssistantResultCode.RateLimited, AsOf = timeProvider.GetUtcNow() });
        }

        var (arguments, error) = McpArguments.Parse(call.Arguments, tool.Parameters);
        if (error is not null)
        {
            return (McpToolResults.InvalidArguments, McpToolResults.Error(McpToolResults.InvalidArguments, error.Message, error.Field));
        }

        if (tool.Check?.Invoke(arguments!) is { } rejected)
        {
            return (McpToolResults.InvalidArguments, McpToolResults.Error(McpToolResults.InvalidArguments, rejected.Message, rejected.Field));
        }

        var invocation = new AssistantInvocation(AdapterNameOfRequest(), RequestIdOf(tool, user, arguments!), FallbackTimeZone: null, arguments!.BabyId, arguments.TimeZone);
        try
        {
            return Rendered(await tool.Run(assistant, invocation, arguments, cancellationToken));
        }
        catch (DomainException exception)
        {
            return ($"{McpToolResults.Rejected}:{exception.Code}", McpToolResults.Error(McpToolResults.Rejected, $"Lotties refused the change ({exception.Code})."));
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogError(exception, "MCP {Tool} failed (correlation {CorrelationId})", tool.Name, httpContextAccessor.HttpContext?.TraceIdentifier);
            return (McpToolResults.InternalError, McpToolResults.Error(McpToolResults.InternalError, "Something went wrong. Try again later."));
        }
    }

    private string AdapterNameOfRequest() =>
        string.Equals(httpContextAccessor.HttpContext?.Request.Headers[ClientHeader].ToString(), SiriAdapterName, StringComparison.OrdinalIgnoreCase)
            ? SiriAdapterName
            : AdapterName;

    private (string Code, CallToolResult Result) Rendered(AssistantResult result)
    {
        var locale = httpContextAccessor.HttpContext?.Request.Headers[SpeechLocaleHeader].ToString();
        var speech = string.IsNullOrWhiteSpace(locale) ? null : AlexaLanguages.For(locale).Say(result);
        return (AssistantResult.CodeName(result.Code), McpToolResults.From(result, speech));
    }

    /// <summary>
    /// The request id the written event's id derives from (<see cref="Domain.Assistants.AssistantEventIds"/>): for a write with
    /// an idempotency key, the key scoped to the user (a hash of issuer and subject, so two users' equal keys never collide);
    /// else a fresh random id (MCP is stateless since 2026-07-28 and JSON-RPC ids repeat across conversations, so they cannot
    /// tell a retry from a second bottle).
    /// </summary>
    private static string RequestIdOf(McpTool tool, ClaimsPrincipal? user, McpArguments arguments) =>
        tool.Writes && arguments.IdempotencyKey is { } key
            ? $"key:{UserTag(user)}:{key}"
            : $"call:{Guid.NewGuid():N}";

    private static string UserTag(ClaimsPrincipal? user)
    {
        var identity = $"{user?.FindFirst(OidcClaims.Issuer)?.Value}\n{user?.FindFirst(OidcClaims.Subject)?.Value}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)))[..32];
    }
}
