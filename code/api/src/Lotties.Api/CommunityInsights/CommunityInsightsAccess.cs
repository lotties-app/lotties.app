using Lotties.Application.CommunityInsights;
using Microsoft.Extensions.Options;

namespace Lotties.Api.CommunityInsights;

/// <summary>Startup validation of <see cref="CommunityAggregationOptions"/>: the run hour must be in [0,23].</summary>
internal sealed class CommunityAggregationOptionsValidator : IValidateOptions<CommunityAggregationOptions>
{
    public ValidateOptionsResult Validate(string? name, CommunityAggregationOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        if (options.RunHourUtc is < 0 or > 23)
        {
            return ValidateOptionsResult.Fail("CommunityAggregation:RunHourUtc must be between 0 and 23.");
        }

        return ValidateOptionsResult.Success;
    }
}

/// <summary>Endpoint metadata: the route belongs to community insights (docs/design/34-community-insights.md, task T2).</summary>
internal sealed class CommunityInsightsEndpointMetadata
{
    private CommunityInsightsEndpointMetadata()
    {
    }

    public static CommunityInsightsEndpointMetadata Instance { get; } = new();
}

/// <summary>
/// Runs right after authentication, on community insights routes only: while <see cref="CommunityInsightsOptions.Enabled"/> is false
/// (the default) every such route answers a bare 404 before any 401 or 403, so the feature looks like no route (as the data-store routes
/// and the project board do) and the web shows nothing.
/// </summary>
internal sealed class CommunityInsightsRequestGuard(RequestDelegate next, IOptionsMonitor<CommunityInsightsOptions> options)
{
    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.GetEndpoint()?.Metadata.GetMetadata<CommunityInsightsEndpointMetadata>() is not null && !options.CurrentValue.Enabled)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        await next(context);
    }
}

internal static class CommunityInsightsAccessExtensions
{
    /// <summary>Binds <see cref="CommunityInsightsOptions"/> (section <c>CommunityInsights</c>, e.g. env <c>CommunityInsights__Enabled</c>; off by default) and the aggregation job options (<c>CommunityAggregation</c>; off by default).</summary>
    public static IServiceCollection AddCommunityInsightsAccess(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<CommunityInsightsOptions>().Bind(configuration.GetSection(CommunityInsightsOptions.SectionName));
        services.AddOptions<CommunityAggregationOptions>().Bind(configuration.GetSection(CommunityAggregationOptions.SectionName)).ValidateOnStart();
        services.AddOptions<Lotties.Domain.Predictions.PredictionOptions>()
            .Bind(configuration.GetSection("PredictionOptions"))
            .PostConfigure(options =>
            {
                if (options.ColdStartTypeKeys.Count == 0)
                {
                    options = options with { ColdStartTypeKeys = new HashSet<Lotties.Domain.EventTypes.EventTypeKey> { Lotties.Domain.EventTypes.BuiltInEventTypes.Feeding.Key } };
                }
            });
        services.AddSingleton<IValidateOptions<CommunityAggregationOptions>, CommunityAggregationOptionsValidator>();
        services.AddHostedService<CommunityAggregationJob>();
        return services;
    }

    public static IApplicationBuilder UseCommunityInsightsRequestGuard(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<CommunityInsightsRequestGuard>();
    }
}
