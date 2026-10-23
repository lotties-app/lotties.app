using Lotties.Api.Limits;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Assistants.Alexa;

public static class AlexaServiceCollectionExtensions
{
    /// <summary>
    /// Binds and validates (at startup) <see cref="AlexaOptions"/> and registers the skill: the request verifier with the
    /// operating system's roots (<see cref="AlexaTrustAnchors.System"/>), the cached certificate chain download over the named
    /// client <see cref="HttpAlexaCertificateChainProvider.HttpClientName"/> (no redirects, no cookies, response size capped),
    /// the per-user assistant limiter and the request handler.
    /// </summary>
    public static IServiceCollection AddAlexaSkill(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<AlexaOptions>().Bind(configuration.GetSection(AlexaOptions.SectionName)).ValidateOnStart();
        services.AddSingleton<IPostConfigureOptions<AlexaOptions>>(new AlexaSkillIdsFromText(configuration));
        services.TryAddEnumerable(ServiceDescriptor.Singleton<IValidateOptions<AlexaOptions>, AlexaOptionsValidator>());
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton(AlexaTrustAnchors.System);
        services.AddHttpClient(HttpAlexaCertificateChainProvider.HttpClientName)
            .ConfigureHttpClient((provider, client) => client.MaxResponseContentBufferSize = provider.GetRequiredService<IOptions<AlexaOptions>>().Value.CertMaxBytes)
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { UseCookies = false, AllowAutoRedirect = false });
        services.TryAddSingleton<IAlexaCertificateChainProvider, HttpAlexaCertificateChainProvider>();
        services.TryAddSingleton<IAlexaRequestVerifier, AlexaRequestVerifier>();
        services.TryAddSingleton<AssistantRateLimiter>();
        services.AddScoped<AlexaSkill>();
        return services;
    }

    /// <summary>
    /// Maps <c>POST /alexa</c>: anonymous for ASP.NET (no bearer token: Amazon's signature and the account-linking token in
    /// the body authenticate it, see <see cref="AlexaSkill"/>); 404 while Alexa is disabled.
    /// </summary>
    public static IEndpointRouteBuilder MapAlexaEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapPost("/alexa", (HttpContext context, AlexaSkill skill, CancellationToken cancellationToken) => skill.HandleAsync(context, cancellationToken))
            .AllowAnonymous()
            .WithName("AlexaSkill")
            .Produces<AlexaResponseEnvelope>()
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status413PayloadTooLarge);
        return api;
    }
}
