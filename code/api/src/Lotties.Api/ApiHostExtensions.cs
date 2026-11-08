using Lotties.Api.Assistants.Alexa;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Authentication;
using Lotties.Api.Authorization;
using Lotties.Api.Board;
using Lotties.Api.Board.Mcp;
using Lotties.Api.Configuration;
using Lotties.Api.Consents;
using Lotties.Api.Cors;
using Lotties.Api.Demo;
using Lotties.Api.Errors;
using Lotties.Api.Limits;
using Lotties.Api.Proxy;
using Lotties.Api.Push;
using Lotties.Api.Serialization;
using Lotties.Api.Stores;
using Lotties.Application;
using Lotties.Application.Push;
using Lotties.Infrastructure;
using Lotties.Infrastructure.AddressLookup;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.AutoMigration;
using Lotties.Infrastructure.Push;
using Lotties.Infrastructure.Stores;
using Lotties.Infrastructure.Stores.Migration;
using Lotties.Infrastructure.Stores.Moves;

namespace Lotties.Api;

public static class ApiHostExtensions
{
    /// <summary>Registers configuration aliases, persistence, the opt-in startup migration, application services, push notifications (off without VAPID keys), OIDC auth, baby policies, CORS, problem details, request limits, trusted proxy headers, the Alexa skill and the MCP server (both off by default), the project board (off by default), the sealed store credentials, the store migrator, the move worker and the data store routing of bring-your-own-database (<c>Stores:Enabled</c>, off by default) and JSON converters.</summary>
    public static WebApplicationBuilder AddLottiesApi(this WebApplicationBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.Configuration.AddEnvironmentAliases(Environment.GetEnvironmentVariable);
        builder.Services.AddInfrastructure(DatabaseOptions.FromEnvironment());
        builder.Services.AddDataStoreRouting(builder.Configuration);
        builder.Services.AddDatabaseMigration(DatabaseOptions.ForMigratorFromEnvironment());
        builder.Services.AddApplication();
        builder.Services.AddPush(builder.Configuration);
        builder.Services.AddNotificationPersistence();
        builder.Services.AddPushNotifications();
        builder.Services.AddSingleton<IPushConfiguration, PushOptionsConfiguration>();

        builder.Services.AddAddressLookup(builder.Configuration);
        builder.Services.AddStoreCredentials(builder.Configuration);
        builder.Services.AddStoreMigrator(builder.Configuration);
        builder.Services.AddStoreMoveWorker(builder.Configuration);
        builder.Services.AddDataStoreAccess(builder.Configuration);
        builder.Services.AddStoreManagementFallbacks();
        builder.Services.AddNotificationScheduler();
        builder.Services.AddOidcAuthentication(builder.Configuration);
        builder.Services.AddTryItDemo(builder.Configuration);
        builder.Services.AddBabyAuthorization();
        builder.Services.AddApiCors(builder.Configuration);
        builder.Services.AddApiProblemDetails();
        builder.Services.AddRequestLimits(builder.Configuration);
        builder.Services.AddTrustedProxyHeaders(builder.Configuration);
        builder.Services.AddAlexaSkill(builder.Configuration);
        builder.Services.AddMcpAdapter(builder.Configuration);
        builder.Services.AddProjectBoard(builder.Configuration);
        builder.Services.AddBoardMcp(builder.Configuration);
        builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(new EventPayloadJsonConverter()));
        return builder;
    }

    /// <summary>
    /// Adds the trusted proxy headers (client address and scheme), CORS, problem details (exception and status-code
    /// mapping), the request body limit, authentication, the MCP request guard (404 while disabled, origin, the MCP token's
    /// user), the board MCP guard (404 unless the board and its MCP endpoint are on, origin), the board guard (404 while disabled, the board API key's identity), the data-store guard (404 while <c>Stores:Enabled</c> is off), the per-user rate limiter and request timeouts, authorization, and the MCP scope gate, in that order.
    /// </summary>
    public static WebApplication UseLottiesApi(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.UseTrustedProxyHeaders();
        app.UseCors();
        app.UseApiProblemDetails();
        app.UseRequestBodyLimits();
        app.UseAuthentication();
        app.UseMcpRequestGuard();
        app.UseBoardMcpRequestGuard();
        app.UseBoardRequestGuard();
        app.UseDataStoreRequestGuard();
        app.UseRequestRateAndTimeLimits();
        app.UseAuthorization();
        app.UseConsentGate();
        app.UseDemoGate();
        app.UseMcpScopeGate();
        return app;
    }

    /// <summary>
    /// Applies pending EF Core migrations with the migrator credentials when <c>DB_AUTO_MIGRATE</c> is true (off by
    /// default). Call after <c>Build()</c> and before <c>Run()</c>: hosted services (push scheduler) and the server
    /// start only afterwards, and a failure ends startup.
    /// </summary>
    public static async Task<WebApplication> MigrateDatabaseIfEnabledAsync(this WebApplication app, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(app);
        await app.Services.GetRequiredService<StartupDatabaseMigration>().RunAsync(cancellationToken);
        return app;
    }
}
