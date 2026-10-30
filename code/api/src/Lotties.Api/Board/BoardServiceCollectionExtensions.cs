using Lotties.Application.Board;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;

namespace Lotties.Api.Board;

internal static class BoardServiceCollectionExtensions
{
    /// <summary>
    /// The project board (docs/design/36-project-board.md): <see cref="BoardOptions"/> (off by default), the realm role
    /// claims transformation, the <c>BoardKey</c> scheme, the board policies and the request's board caller.
    /// </summary>
    public static IServiceCollection AddProjectBoard(this IServiceCollection services, IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(configuration);
        services.AddOptions<BoardOptions>().Bind(configuration.GetSection(BoardOptions.SectionName));
        services.AddSingleton<IClaimsTransformation, BoardRoleClaimsTransformation>();
        services.AddAuthentication().AddScheme<AuthenticationSchemeOptions, BoardKeyAuthenticationHandler>(BoardKeyAuthenticationHandler.SchemeName, null);
        services.AddAuthorizationBuilder()
            .AddPolicy(BoardPolicies.Read, policy => RequirePermission(policy, BoardClaims.Read))
            .AddPolicy(BoardPolicies.Write, policy => RequirePermission(policy, BoardClaims.Write))
            .AddPolicy(BoardPolicies.Admin, policy => RequirePermission(policy, BoardClaims.Admin));
        services.AddScoped<IBoardCaller, HttpBoardCaller>();
        return services;
    }

    /// <summary>The board guard (<see cref="BoardRequestGuard"/>): right after authentication, before the rate limiter.</summary>
    public static IApplicationBuilder UseBoardRequestGuard(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<BoardRequestGuard>();
    }

    private static void RequirePermission(AuthorizationPolicyBuilder policy, string permission) =>
        policy.RequireAuthenticatedUser().RequireClaim(BoardClaims.Permission, permission);
}
