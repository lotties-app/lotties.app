using Lotties.Api.Consents;
using Lotties.Application.Consents;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

internal static class ConsentEndpoints
{
    private const string Path = "/me/consents";

    private const string Reason = "A person must always be able to read and give her own consent (and so leave) whatever its state.";

    /// <summary>
    /// Maps <c>GET /me/consents</c>, <c>PUT /me/consents/core</c> and <c>PUT /me/consents/optional/{push|alexa|mcp}</c>: any signed-in
    /// user of any role (a Doctor included), exempt from the consent gate (docs/design/38-consent-and-terms.md section 4).
    /// </summary>
    public static IEndpointRouteBuilder MapConsentEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        var consents = api.MapGroup(Path).AllowWithoutConsent(Reason);
        consents.MapGet(string.Empty, GetAsync)
            .WithName("GetConsents");
        consents.MapPut("/core", AcceptCoreAsync)
            .WithName("AcceptCoreConsent")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict);
        consents.MapPut("/optional/{kind}", SetOptionalAsync)
            .WithName("SetOptionalConsent")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
        return api;
    }

    private static async Task<Ok<ConsentsResponse>> GetAsync(IConsentService consents, CancellationToken cancellationToken) =>
        TypedResults.Ok(await consents.GetMineAsync(cancellationToken));

    private static async Task<Ok<ConsentsResponse>> AcceptCoreAsync(AcceptCoreConsentRequest request, IConsentService consents, CancellationToken cancellationToken) =>
        TypedResults.Ok(await consents.AcceptCoreAsync(request, cancellationToken));

    private static async Task<Results<Ok<ConsentsResponse>, NotFound>> SetOptionalAsync(
        string kind,
        SetOptionalConsentRequest request,
        IConsentService consents,
        CancellationToken cancellationToken) =>
        await consents.SetOptionalAsync(kind, request, cancellationToken) is { } view ? TypedResults.Ok(view) : TypedResults.NotFound();
}
