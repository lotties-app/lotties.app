using BabyRoutine.Api.Authentication;
using BabyRoutine.Api.Authorization;
using BabyRoutine.Api.Configuration;
using BabyRoutine.Api.Cors;
using BabyRoutine.Api.Errors;
using BabyRoutine.Api.Limits;
using BabyRoutine.Api.Serialization;
using BabyRoutine.Application;
using BabyRoutine.Infrastructure;
using BabyRoutine.Infrastructure.Persistence;

namespace BabyRoutine.Api;

public static class ApiHostExtensions
{
    /// <summary>Registers configuration aliases, persistence, application services, OIDC auth, baby policies, CORS, problem details, request limits and JSON converters.</summary>
    public static WebApplicationBuilder AddBabyRoutineApi(this WebApplicationBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);
        builder.Configuration.AddEnvironmentAliases(Environment.GetEnvironmentVariable);
        builder.Services.AddInfrastructure(DatabaseOptions.FromEnvironment());
        builder.Services.AddApplication();
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
}
