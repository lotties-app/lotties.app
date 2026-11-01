namespace Lotties.Api.Errors;

internal static class ProblemDetailsExtensions
{
    /// <summary>The member ASP.NET Core's default problem details writer adds since .NET 9 (camelCase, as the API's JSON).</summary>
    public const string TraceIdExtension = "traceId";

    /// <summary>
    /// Registers RFC 7807 problem details and the <see cref="DomainExceptionHandler"/>, as they were on ASP.NET Core 8:
    /// problem bodies carry no <c>traceId</c> member (ASP.NET Core 9 started adding one to every body), and the exception
    /// handler middleware keeps recording every exception (the "unhandled exception" error log, the <c>error.type</c>
    /// metric tag), which ASP.NET Core 10 stopped doing for the ones an <see cref="Microsoft.AspNetCore.Diagnostics.IExceptionHandler"/> answered.
    /// </summary>
    public static IServiceCollection AddApiProblemDetails(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);
        services.AddProblemDetails(options => options.CustomizeProblemDetails = context => context.ProblemDetails.Extensions.Remove(TraceIdExtension));
        services.AddExceptionHandler<DomainExceptionHandler>();
        services.Configure<ExceptionHandlerOptions>(options => options.SuppressDiagnosticsCallback = _ => false);
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
