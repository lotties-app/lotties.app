using Microsoft.AspNetCore.Http.Timeouts;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace BabyRoutine.Api.Limits;

internal static class RequestLimitsServiceCollectionExtensions
{
    /// <summary>
    /// Registers <see cref="RequestLimitsOptions"/> (validated at startup), request timeouts (default and
    /// <see cref="RequestLimitPolicies.Import"/>; a timed-out request is 504) and the per-user rate limiter.
    /// </summary>
    public static IServiceCollection AddRequestLimits(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<RequestLimitsOptions>().Bind(configuration.GetSection(RequestLimitsOptions.SectionName)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<RequestLimitsOptions>, RequestLimitsOptionsValidator>();
        services.AddRequestTimeouts();
        services.AddOptions<RequestTimeoutOptions>().Configure<IOptions<RequestLimitsOptions>>((timeouts, limits) => ConfigureTimeouts(timeouts, limits.Value));
        services.AddRateLimiter(_ => { });
        services.AddOptions<RateLimiterOptions>().Configure<IOptions<RequestLimitsOptions>>((rateLimiter, limits) => UserRateLimits.Configure(rateLimiter, limits.Value));
        return services;
    }

    /// <summary>Adds the body size limit; call before reading bodies, after problem details are set up.</summary>
    public static IApplicationBuilder UseRequestBodyLimits(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<RequestBodyLimitMiddleware>();
    }

    /// <summary>Adds the rate limiter and request timeouts; call after authentication so requests are counted per user.</summary>
    public static IApplicationBuilder UseRequestRateAndTimeLimits(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.UseRateLimiter();
        app.UseRequestTimeouts();
        return app;
    }

    private static void ConfigureTimeouts(RequestTimeoutOptions timeouts, RequestLimitsOptions limits)
    {
        timeouts.DefaultPolicy = new RequestTimeoutPolicy
        {
            Timeout = TimeSpan.FromSeconds(limits.RequestTimeoutSeconds),
            TimeoutStatusCode = StatusCodes.Status504GatewayTimeout,
        };
        timeouts.AddPolicy(RequestLimitPolicies.Import, new RequestTimeoutPolicy
        {
            Timeout = TimeSpan.FromSeconds(limits.ImportRequestTimeoutSeconds),
            TimeoutStatusCode = StatusCodes.Status504GatewayTimeout,
        });
    }
}
