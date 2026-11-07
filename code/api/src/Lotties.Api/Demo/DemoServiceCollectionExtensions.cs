using System.Text;
using System.Threading.RateLimiting;
using Lotties.Api.Limits;
using Lotties.Application.Demo;
using Lotties.Infrastructure.Notifications;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Demo;

/// <summary>Startup validation of <see cref="DemoOptions"/>: a set signing key must be long enough, and the numbers positive (a blank key just switches the demo off).</summary>
internal sealed class DemoOptionsValidator : IValidateOptions<DemoOptions>
{
    public ValidateOptionsResult Validate(string? name, DemoOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        var failures = new List<string>();
        if (options.IsEnabled && Encoding.UTF8.GetByteCount(options.SigningKey!) < DemoOptions.MinSigningKeyBytes)
        {
            failures.Add($"Demo:SigningKey must be at least {DemoOptions.MinSigningKeyBytes} bytes.");
        }

        if (options.LifetimeDays <= 0)
        {
            failures.Add("Demo:LifetimeDays must be positive.");
        }

        if (options.MaxLiveAccounts <= 0)
        {
            failures.Add("Demo:MaxLiveAccounts must be positive.");
        }

        if (options.StartPermitsPerHour <= 0)
        {
            failures.Add("Demo:StartPermitsPerHour must be positive.");
        }

        return failures.Count == 0 ? ValidateOptionsResult.Success : ValidateOptionsResult.Fail(failures);
    }
}

internal static class DemoServiceCollectionExtensions
{
    /// <summary>
    /// Registers the try-it demo (docs/design/45-try-it-demo.md): the validated <c>Demo</c> options (also as a plain singleton), the token issuer, the
    /// <c>Demo</c> bearer scheme with the default scheme's selector, and the cleanup of expired accounts. Off without <c>Demo:SigningKey</c>.
    /// </summary>
    public static IServiceCollection AddTryItDemo(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<DemoOptions>().Bind(configuration.GetSection(DemoOptions.SectionName)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<DemoOptions>, DemoOptionsValidator>();
        services.AddSingleton(provider => provider.GetRequiredService<IOptions<DemoOptions>>().Value);
        services.AddSingleton<IDemoTokenIssuer, DemoTokenIssuer>();
        services.AddAuthentication().AddJwtBearer(DemoTokens.SchemeName, _ => { });
        services.AddSingleton<IConfigureOptions<JwtBearerOptions>, ConfigureDemoJwtBearerOptions>();
        services.AddSingleton<IPostConfigureOptions<JwtBearerOptions>, SelectDemoScheme>();
        services.AddOptions<RateLimiterOptions>().Configure<DemoOptions>((rateLimiter, demo) =>
            rateLimiter.AddPolicy(RequestLimitPolicies.DemoStart, context => RateLimitPartition.GetFixedWindowLimiter(
                $"demo-start:{context.Connection.RemoteIpAddress}",
                _ => new FixedWindowRateLimiterOptions { PermitLimit = demo.StartPermitsPerHour, Window = TimeSpan.FromHours(1), QueueLimit = 0 })));
        services.AddHostedService<DemoCleanupService>();
        return services;
    }

    public static IApplicationBuilder UseDemoGate(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<DemoGateMiddleware>();
    }
}
