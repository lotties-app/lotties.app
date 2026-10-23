using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Assistants.Mcp;

/// <summary>
/// Endpoint metadata: the route belongs to the MCP server: the message endpoint itself (<c>POST</c>), or one of its public
/// routes (the protected resource metadata, the 405 answers to <c>GET</c> and <c>DELETE</c>).
/// </summary>
internal sealed class McpEndpointMetadata
{
    private McpEndpointMetadata(bool isEndpoint) => IsEndpoint = isEndpoint;

    public static McpEndpointMetadata Endpoint { get; } = new(isEndpoint: true);

    public static McpEndpointMetadata Metadata { get; } = new(isEndpoint: false);

    /// <summary><c>true</c> for the Streamable HTTP message endpoint, <c>false</c> for the public routes.</summary>
    public bool IsEndpoint { get; }
}

/// <summary>
/// Runs right after authentication, before the rate limiter, on MCP routes only: every MCP route answers 404 while
/// <see cref="McpOptions.Enabled"/> is false (before any 401, so a disabled server looks like no route); an <c>Origin</c>
/// that is not in <see cref="McpOptions.AllowedOrigins"/> is 403 on the endpoint (MCP Streamable HTTP: DNS rebinding
/// protection); and the MCP token's user becomes the request's user, so the per-user rate limit counts her (the API's own
/// scheme does not accept MCP tokens).
/// </summary>
internal sealed class McpRequestGuard(RequestDelegate next, IOptionsMonitor<McpOptions> options, ILogger<McpRequestGuard> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.GetEndpoint()?.Metadata.GetMetadata<McpEndpointMetadata>() is not { } route)
        {
            await next(context);
            return;
        }

        var settings = options.CurrentValue;
        if (!settings.Enabled)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        if (route.IsEndpoint && context.Request.Headers.Origin.ToString() is { Length: > 0 } origin && !settings.AllowsOrigin(origin))
        {
            logger.LogWarning("MCP request refused: origin not allowed (correlation {CorrelationId})", context.TraceIdentifier);
            await McpHttpErrors.WriteAsync(context, StatusCodes.Status403Forbidden, "Origin not allowed.");
            return;
        }

        if (route.IsEndpoint && (await context.AuthenticateAsync(McpTokens.SchemeName)) is { Succeeded: true } authenticated)
        {
            context.User = authenticated.Principal;
        }

        await next(context);
    }
}

/// <summary>
/// Runs after authorization, on the MCP endpoint only: a token with neither <see cref="McpScopes.Read"/> nor
/// <see cref="McpScopes.Write"/> is 403 <c>insufficient_scope</c> on every message; a body larger than
/// <see cref="McpOptions.MaxRequestBodyBytes"/> is 413 (read once, bounded, then handed to the SDK); and a
/// <c>tools/call</c> of a tool whose scope the token lacks is 403 with <c>WWW-Authenticate: Bearer
/// error="insufficient_scope", scope="..."</c> (the MCP scope challenge, so a client can step up). Anything that does not parse
/// is left to the SDK, which answers with the JSON-RPC error.
/// </summary>
internal sealed class McpScopeGate(RequestDelegate next, IOptionsMonitor<McpOptions> options, ILogger<McpScopeGate> logger)
{
    private const int MaxJsonDepth = 32;

    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.GetEndpoint()?.Metadata.GetMetadata<McpEndpointMetadata>() is not { IsEndpoint: true })
        {
            await next(context);
            return;
        }

        var settings = options.CurrentValue;
        var granted = McpScopes.Of(context.User);
        if (granted.Count == 0)
        {
            await RefuseScopeAsync(context, settings, [McpResource.ChallengeScope]);
            return;
        }

        if (HttpMethods.IsPost(context.Request.Method) && !await GateBodyAsync(context, settings, granted))
        {
            return;
        }

        await next(context);
    }

    /// <summary>Reads the body (bounded), refuses it when too large or when it calls a tool the token cannot; else puts it back.</summary>
    private async Task<bool> GateBodyAsync(HttpContext context, McpOptions settings, IReadOnlySet<string> granted)
    {
        var body = await ReadBoundedAsync(context.Request, settings.MaxRequestBodyBytes, context.RequestAborted);
        if (body is null)
        {
            logger.LogInformation("MCP request refused: body larger than {MaxBytes} bytes (correlation {CorrelationId})", settings.MaxRequestBodyBytes, context.TraceIdentifier);
            await McpHttpErrors.WriteAsync(context, StatusCodes.Status413PayloadTooLarge, $"The request body must be at most {settings.MaxRequestBodyBytes} bytes.");
            return false;
        }

        context.Request.Body = new MemoryStream(body, writable: false);
        var missing = ScopesOfToolCalls(body).Where(scope => !granted.Contains(scope)).Distinct(StringComparer.Ordinal).ToArray();
        if (missing.Length == 0)
        {
            return true;
        }

        await RefuseScopeAsync(context, settings, missing);
        return false;
    }

    private async Task RefuseScopeAsync(HttpContext context, McpOptions settings, IReadOnlyList<string> scopes)
    {
        logger.LogInformation("MCP request refused: insufficient scope {Scopes} (correlation {CorrelationId})", string.Join(' ', scopes), context.TraceIdentifier);
        var metadataUrl = McpResource.MetadataUrlOf(McpResource.UrlOf(context.Request, settings));
        context.Response.Headers.WWWAuthenticate = McpResource.InsufficientScopeChallenge(metadataUrl, scopes);
        await McpHttpErrors.WriteAsync(context, StatusCodes.Status403Forbidden, $"The access token does not grant {string.Join(" and ", scopes)}.");
    }

    /// <summary>The scopes of the known tools the body's <c>tools/call</c> messages name (one message, or a legacy batch).</summary>
    private static IEnumerable<string> ScopesOfToolCalls(byte[] body)
    {
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = MaxJsonDepth });
        }
        catch (JsonException)
        {
            return [];
        }

        using (document)
        {
            var messages = document.RootElement.ValueKind == JsonValueKind.Array ? document.RootElement.EnumerateArray().ToArray() : [document.RootElement];
            return messages.Select(ToolNameOf).Select(McpToolCatalog.Find).OfType<McpTool>().Select(tool => tool.Scope).ToArray();
        }
    }

    private static string? ToolNameOf(JsonElement message) =>
        message.ValueKind == JsonValueKind.Object
        && message.TryGetProperty("method", out var method) && method.ValueKind == JsonValueKind.String && method.GetString() == "tools/call"
        && message.TryGetProperty("params", out var parameters) && parameters.ValueKind == JsonValueKind.Object
        && parameters.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String
            ? name.GetString()
            : null;

    /// <summary>The body, or <c>null</c> when it is (or declares to be) larger than <paramref name="maxBytes"/>.</summary>
    private static async Task<byte[]?> ReadBoundedAsync(HttpRequest request, int maxBytes, CancellationToken cancellationToken)
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

/// <summary>The MCP routes' own HTTP errors: the status and a JSON-RPC error without an id (MCP Streamable HTTP allows it).</summary>
internal static class McpHttpErrors
{
    private const int InvalidRequest = -32600;

    public static Task WriteAsync(HttpContext context, int status, string message)
    {
        context.Response.StatusCode = status;
        return context.Response.WriteAsJsonAsync(new { jsonrpc = "2.0", error = new { code = InvalidRequest, message } }, context.RequestAborted);
    }
}
