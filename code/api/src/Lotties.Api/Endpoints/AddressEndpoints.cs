using Lotties.Api.Consents;
using Lotties.Api.Limits;
using Lotties.Application.AddressLookup;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The address lookup proxy of the provider sheet (docs/design/23-address-lookup.md): any signed-in user (no baby is involved
/// and nothing about a baby is ever sent upstream). Each route has its own per-user rate limit
/// (<see cref="RequestLimitPolicies.AddressLookup"/>) on top of the global one.
/// </summary>
internal static class AddressEndpoints
{
    private const string AddressPath = "/address";

    /// <summary>
    /// Maps <c>GET /address/lookup?cep=</c> (a Brazilian postal code: street, neighborhood, city, state; 400 / 404
    /// <c>address_not_found</c> / 502 <c>address_lookup_unavailable</c> / 503 <c>address_lookup_disabled</c>) and
    /// <c>GET /address/search?q=&amp;lang=</c> (OpenStreetMap places, at most 5, an empty list when nothing matches).
    /// </summary>
    public static IEndpointRouteBuilder MapAddressEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        var address = api.MapGroup(AddressPath)
            .RequireRateLimiting(RequestLimitPolicies.AddressLookup)
            .AllowWithoutConsent("Address lookup is not baby data: only what the person types goes to the proxy (docs/design/23-address-lookup.md).");
        address.MapGet("/lookup", LookupAsync)
            .WithName("LookupAddressByCep")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status502BadGateway)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
        address.MapGet("/search", SearchAsync)
            .WithName("SearchAddress")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status502BadGateway)
            .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
        return api;
    }

    private static async Task<Ok<CepAddressResponse>> LookupAsync(string? cep, IAddressLookupService lookup, CancellationToken cancellationToken) =>
        TypedResults.Ok(await lookup.LookupCepAsync(cep, cancellationToken));

    private static async Task<Ok<PlaceSearchResponse>> SearchAsync(string? q, string? lang, IAddressLookupService lookup, CancellationToken cancellationToken) =>
        TypedResults.Ok(await lookup.SearchAsync(q, lang, cancellationToken));
}
