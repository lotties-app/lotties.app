using Lotties.Api.Configuration;
using Lotties.Application.Users;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Authentication;

internal static class AuthenticationServiceCollectionExtensions
{
    /// <summary>
    /// Registers JWT bearer authentication against the configured OIDC authority, validated at startup, the
    /// account-linking scheme with the same validation (<see cref="AccountLinkTokens"/>), and <see cref="ICurrentUser"/> for
    /// the request's user. In Local mode, skips OIDC entirely and registers a synthetic <see cref="LocalCurrentUser"/>.
    /// </summary>
    public static IServiceCollection AddOidcAuthentication(this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);

        if (environment.IsLocalMode())
        {
            // Local/self-hosted mode: no OIDC, single synthetic user, all requests auto-authenticated.
            services.AddHttpContextAccessor();
            services.AddScoped<ICurrentUser, LocalCurrentUser>();
            return services;
        }

        services.AddOptions<AuthOptions>().Bind(configuration.GetSection(AuthOptions.SectionName)).ValidateOnStart();
        services.AddSingleton<IValidateOptions<AuthOptions>, AuthOptionsValidator>();
        services.AddSingleton<IConfigureOptions<JwtBearerOptions>, ConfigureJwtBearerOptions>();
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer().AddJwtBearer(AccountLinkTokens.SchemeName);
        services.AddSingleton<IAccountLinkTokenValidator, AccountLinkTokenValidator>();
        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, HttpCurrentUser>();
        services.AddHttpClient<IIdentityAccountRemover, KeycloakAccountRemover>(client => client.Timeout = TimeSpan.FromSeconds(10));
        return services;
    }
}
