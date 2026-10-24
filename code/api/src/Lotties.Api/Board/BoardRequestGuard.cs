using Lotties.Api.Errors;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Lotties.Api.Board;

/// <summary>Endpoint metadata: the route belongs to the project board.</summary>
internal sealed class BoardEndpointMetadata
{
    private BoardEndpointMetadata()
    {
    }

    public static BoardEndpointMetadata Instance { get; } = new();
}

/// <summary>
/// Runs right after authentication, before the rate limiter, on board routes only (docs/design/36-project-board.md
/// sections 3 and 4.2): every board route answers 404 while <see cref="BoardOptions.Enabled"/> is false (before any 401,
/// so a disabled board looks like no route); a presented board key is authenticated with the <c>BoardKey</c> scheme and
/// becomes the request's user (so the per-key rate limit and the policies see it), and an invalid one is 401
/// <c>invalid_board_key</c> at once, whatever else the request carries.
/// </summary>
internal sealed class BoardRequestGuard(RequestDelegate next, IOptionsMonitor<BoardOptions> options, IProblemDetailsService problemDetails, ILogger<BoardRequestGuard> logger)
{
    public const string InvalidKeyCode = "invalid_board_key";

    public async Task InvokeAsync(HttpContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (context.GetEndpoint()?.Metadata.GetMetadata<BoardEndpointMetadata>() is null)
        {
            await next(context);
            return;
        }

        if (!options.CurrentValue.Enabled)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        if (BoardKeyAuthenticationHandler.IsPresented(context.Request))
        {
            var result = await context.AuthenticateAsync(BoardKeyAuthenticationHandler.SchemeName);
            if (!result.Succeeded)
            {
                logger.LogInformation("Board request refused: invalid board key (correlation {CorrelationId})", context.TraceIdentifier);
                await RefuseAsync(context);
                return;
            }

            context.User = result.Principal;
        }

        await next(context);
    }

    private Task RefuseAsync(HttpContext context)
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        context.Response.Headers.WWWAuthenticate = "Bearer error=\"invalid_token\"";
        var problem = new ProblemDetails { Status = StatusCodes.Status401Unauthorized, Detail = "The board key is unknown, revoked or expired." };
        problem.Extensions[DomainExceptionHandler.CodeExtension] = InvalidKeyCode;
        return problemDetails.WriteAsync(new ProblemDetailsContext { HttpContext = context, ProblemDetails = problem }).AsTask();
    }
}
