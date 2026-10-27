using Lotties.Application.Consents;
using Lotties.Application.Users;
using Lotties.Domain.Exceptions;

namespace Lotties.Api.Consents;

/// <summary>Marks an endpoint (usually a whole group) as behind the consent gate: <see cref="ConsentGateMiddleware"/> refuses a caller without a current core consent.</summary>
public sealed class ConsentGatedMetadata
{
    public static readonly ConsentGatedMetadata Instance = new();

    private ConsentGatedMetadata()
    {
    }
}

/// <summary>
/// Marks an endpoint as reachable without a current core consent, with the reason (docs/design/38-consent-and-terms.md section 2,
/// decision 4). The list of exempt endpoints is pinned by <c>ConsentGateCoverageTests</c>: a new route is gated by default and
/// stays that way unless it is exempted here <b>and</b> listed in that test.
/// </summary>
public sealed record ConsentExemptMetadata(string Reason);

public static class ConsentGateExtensions
{
    /// <summary>Puts every endpoint of the group behind the consent gate (the whole API group does; a new route inherits it).</summary>
    public static TBuilder RequireConsent<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        return builder.WithMetadata(ConsentGatedMetadata.Instance);
    }

    /// <summary>Exempts the endpoint (or group) from the gate; <paramref name="reason"/> says why it is not baby data or why a person must always reach it.</summary>
    public static TBuilder AllowWithoutConsent<TBuilder>(this TBuilder builder, string reason)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        return builder.WithMetadata(new ConsentExemptMetadata(reason));
    }

    /// <summary>
    /// Adds the consent gate after authorization: a gated endpoint answers 403 <c>consent_required</c> to a signed-in caller without a
    /// current core consent, before any parameter is bound or any handler runs. Anonymous callers are not its business (authorization
    /// already answered 401, or the endpoint is anonymous by design).
    /// </summary>
    public static IApplicationBuilder UseConsentGate(this IApplicationBuilder app)
    {
        ArgumentNullException.ThrowIfNull(app);
        return app.UseMiddleware<ConsentGateMiddleware>();
    }
}

internal sealed class ConsentGateMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, ICurrentUser currentUser, IConsentService consents)
    {
        if (IsGated(context) && context.User.Identity?.IsAuthenticated == true && currentUser.IsAuthenticated)
        {
            var user = await currentUser.GetUserAsync(context.RequestAborted);
            if (!await consents.HasCurrentCoreAsync(user.Id, context.RequestAborted))
            {
                throw new ConsentRequiredException();
            }
        }

        await next(context);
    }

    private static bool IsGated(HttpContext context)
    {
        var metadata = context.GetEndpoint()?.Metadata;
        return metadata is not null && metadata.GetMetadata<ConsentExemptMetadata>() is null && metadata.GetMetadata<ConsentGatedMetadata>() is not null;
    }
}
