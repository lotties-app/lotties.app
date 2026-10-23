using Lotties.Api.Authentication;
using Lotties.Api.Limits;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Protocol;

namespace Lotties.Api.Assistants.Mcp;

public static class McpServiceCollectionExtensions
{
    /// <summary>The CORS policy of the endpoint: only <see cref="McpOptions.AllowedOrigins"/> (none by default).</summary>
    public const string EndpointCorsPolicy = "mcp-endpoint";

    /// <summary>The CORS policy of the metadata documents: public, read-only, any origin, no credentials.</summary>
    public const string MetadataCorsPolicy = "mcp-metadata";

    private const string Instructions =
        "Lotties is a baby care log kept by the baby's family. These tools read, and with the user's permission log, the " +
        "family's own entries: sleep, feeds, diapers, appointments and the vaccine schedule. Answers are facts from that log, " +
        "never medical advice; there is no medication tool. Instants are UTC; timeZone names the family's zone. When the user " +
        "has several babies, call list_babies and pass babyId.";

    /// <summary>
    /// Binds and validates (at startup) <see cref="McpOptions"/>; adds the MCP token scheme (<see cref="McpTokens"/>), its
    /// policy, the CORS policies, the per-user assistant limiter and the official MCP SDK server over Streamable HTTP in
    /// stateless mode (protocol 2026-07-28, and the initialize handshake of 2025-11-25 and earlier, served per request) with
    /// the tools of <see cref="McpToolCatalog"/>. The SDK's own logs are kept at Warning so no message content is logged.
    /// </summary>
    public static IServiceCollection AddMcpAdapter(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<McpOptions>().Bind(configuration.GetSection(McpOptions.SectionName)).ValidateOnStart();
        services.AddSingleton<IPostConfigureOptions<McpOptions>>(new McpAllowedOriginsFromText(configuration));
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<McpOptions>, McpOptionsValidator>());
        services.AddSingleton<IConfigureOptions<JwtBearerOptions>, ConfigureMcpJwtBearerOptions>();
        services.AddAuthentication().AddJwtBearer(McpTokens.SchemeName);
        services.AddAuthorization(options => options.AddPolicy(McpTokens.PolicyName, McpTokens.Policy));
        services.AddOptions<CorsOptions>().Configure<IOptions<McpOptions>>(AddCorsPolicies);
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<AssistantRateLimiter>();
        services.AddScoped<McpToolRunner>();
        services.AddLogging(logging => logging.AddFilter("ModelContextProtocol", LogLevel.Warning));
        services.AddMcpServer(ConfigureServer)
            .WithHttpTransport(transport => transport.Stateless = true)
            .WithListToolsHandler(McpToolRunner.ListToolsAsync)
            .WithCallToolHandler(McpToolRunner.CallToolAsync);
        return services;
    }

    /// <summary>
    /// Maps the MCP endpoint <c>POST /api/v1/mcp</c> (and the SDK's other methods there) behind <see cref="McpTokens.PolicyName"/>,
    /// and the protected resource metadata at <c>/.well-known/oauth-protected-resource</c> and
    /// <c>/.well-known/oauth-protected-resource/api/v1/mcp</c> (anonymous). Every route is 404 while MCP is disabled
    /// (<see cref="McpRequestGuard"/>).
    /// </summary>
    public static WebApplication MapMcpEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.MapMcp(McpResource.Path)
            .RequireAuthorization(McpTokens.PolicyName)
            .RequireCors(EndpointCorsPolicy)
            .WithMetadata(McpEndpointMetadata.Endpoint);

        // Stateless Streamable HTTP has no GET stream and no session to DELETE: 405 (MCP 2026-07-28 "Earlier Streamable HTTP
        // Revisions"), never the API's fallback 401, which would send a client into a sign-in loop.
        app.MapMethods(McpResource.Path, [HttpMethods.Get, HttpMethods.Delete], MethodNotAllowed)
            .AllowAnonymous()
            .RequireCors(EndpointCorsPolicy)
            .WithMetadata(McpEndpointMetadata.Metadata)
            .ExcludeFromDescription();
        foreach (var path in new[] { McpResource.MetadataPrefix, McpResource.MetadataPrefix + McpResource.Path })
        {
            app.MapGet(path, Metadata)
                .AllowAnonymous()
                .RequireCors(MetadataCorsPolicy)
                .WithMetadata(McpEndpointMetadata.Metadata)
                .Produces<McpProtectedResourceMetadata>();
        }

        return app;
    }

    /// <summary>The MCP guards: <see cref="McpRequestGuard"/> right after authentication (before the rate limiter).</summary>
    public static IApplicationBuilder UseMcpRequestGuard(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<McpRequestGuard>();
    }

    /// <summary><see cref="McpScopeGate"/>, right after authorization.</summary>
    public static IApplicationBuilder UseMcpScopeGate(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<McpScopeGate>();
    }

    private static IResult MethodNotAllowed(HttpContext context)
    {
        context.Response.Headers.Allow = HttpMethods.Post;
        return Results.StatusCode(StatusCodes.Status405MethodNotAllowed);
    }

    private static IResult Metadata(HttpContext context, IOptions<McpOptions> mcp, IOptions<AuthOptions> auth)
    {
        context.Response.Headers.CacheControl = "public, max-age=300";
        return Results.Json(McpResource.MetadataOf(McpResource.UrlOf(context.Request, mcp.Value), auth.Value.Authority ?? string.Empty));
    }

    private static void ConfigureServer(ModelContextProtocol.Server.McpServerOptions options)
    {
        options.ServerInfo = new Implementation { Name = "lotties", Title = "Lotties", Version = "1.0.0" };
        options.ServerInstructions = Instructions;
        options.Capabilities = new ServerCapabilities { Tools = new ToolsCapability { ListChanged = false } };
    }

    private static void AddCorsPolicies(CorsOptions cors, IOptions<McpOptions> mcp)
    {
        cors.AddPolicy(EndpointCorsPolicy, policy => policy
            .WithOrigins(mcp.Value.AllowedOrigins.Select(origin => origin.Trim().TrimEnd('/')).ToArray())
            .AllowAnyHeader()
            .WithMethods(HttpMethods.Post, HttpMethods.Get, HttpMethods.Delete)
            .WithExposedHeaders("WWW-Authenticate", "Mcp-Session-Id", "MCP-Protocol-Version"));
        cors.AddPolicy(MetadataCorsPolicy, policy => policy.AllowAnyOrigin().AllowAnyHeader().WithMethods(HttpMethods.Get));
    }
}
