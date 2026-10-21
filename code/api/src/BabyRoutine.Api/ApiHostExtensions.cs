using BabyRoutine.Api.Authentication;
using BabyRoutine.Api.Authorization;
using BabyRoutine.Api.Configuration;
using BabyRoutine.Api.Cors;
using BabyRoutine.Api.Errors;
using BabyRoutine.Api.Limits;
using BabyRoutine.Api.Push;
using BabyRoutine.Api.Serialization;
using BabyRoutine.Application;
using BabyRoutine.Application.Push;
using BabyRoutine.Infrastructure;
using BabyRoutine.Infrastructure.Persistence;
using BabyRoutine.Infrastructure.Persistence.AutoMigration;
using BabyRoutine.Infrastructure.Push;

namespace BabyRoutine.Api;

public static class ApiHostExtensions
{
    /// <summary>Registers configuration aliases, persistence, the opt-in startup migration, application services, push notifications (off without VAPID keys), OIDC auth, baby policies, CORS, problem details, request limits and JSON converters.</summary>
    public static WebApplicationBuilder AddBabyRoutineApi(this WebApplicationBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.Configuration.AddEnvironmentAliases(Environment.GetEnvironmentVariable);
        builder.Services.AddInfrastructure(DatabaseOptions.FromEnvironment());
        builder.Services.AddDatabaseMigration(DatabaseOptions.ForMigratorFromEnvironment());
        builder.Services.AddApplication();
        builder.Services.AddPush(builder.Configuration);
        builder.Services.AddNotificationPersistence();
        builder.Services.AddPushNotifications();
        builder.Services.AddSingleton<IPushConfiguration, PushOptionsConfiguration>();

        builder.Services.AddNotificationScheduler();
        builder.Services.AddOidcAuthentication(builder.Configuration);
        builder.Services.AddBabyAuthorization();
        builder.Services.AddApiCors(builder.Configuration);
        builder.Services.AddApiProblemDetails();
        builder.Services.AddRequestLimits(builder.Configuration);
        builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(new EventPayloadJsonConverter()));
        return builder;
    }

    /// <summary>
    /// Adds CORS, problem details (exception and status-code mapping), the request body limit, authentication, the
    /// per-user rate limiter and request timeouts, and authorization, in that order.
    /// </summary>
    public static WebApplication UseBabyRoutineApi(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.UseCors();
        app.UseApiProblemDetails();
        app.UseRequestBodyLimits();
        app.UseAuthentication();
        app.UseRequestRateAndTimeLimits();
        app.UseAuthorization();
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
