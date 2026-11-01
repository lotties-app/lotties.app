namespace Lotties.Api.Errors;

internal static class ProblemDetailsExtensions
{
    /// <summary>Registers RFC 7807 problem details and the <see cref="DomainExceptionHandler"/>.</summary>
    public static IServiceCollection AddApiProblemDetails(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddProblemDetails();
        services.AddExceptionHandler<DomainExceptionHandler>();
        return services;
    }

    /// <summary>
    /// Turns exceptions into problem responses (domain exceptions mapped, anything else 500) and gives bodiless
    /// error responses, such as failed request binding (400), 401, 403 and 404, a problem body too.
    /// </summary>
    public static IApplicationBuilder UseApiProblemDetails(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        return app;
    }
}
