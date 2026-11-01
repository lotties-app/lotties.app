using Lotties.Api.Errors;
using Lotties.Api.Limits;
using Lotties.Application.Catalog;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The shared, instance-wide medication catalog: any authenticated user (no baby membership involved). Users can search
/// and add community products; editing, merging and deleting need an admin role that does not exist yet.
/// </summary>
internal static class CatalogEndpoints
{
    /// <summary>Error code of a product creation that matched an existing product (409, extension <c>product</c>).</summary>
    public const string ProductExistsCode = "product_exists";

    /// <summary>Problem extension carrying the existing product of a <see cref="ProductExistsCode"/> conflict.</summary>
    public const string ProductExtension = "product";

    private const string CatalogPath = "/catalog";
    private const string ProductsPath = "/products";
    private const string ProductPath = ProductsPath + "/{productId:guid}";
    private const string SubstancesPath = "/substances";
    private const string SubstanceProductsPath = SubstancesPath + "/{substanceId:guid}/products";

    /// <summary>
    /// Maps <c>GET /catalog/products?q=&amp;limit=</c>, <c>GET /catalog/products/{productId}</c>,
    /// <c>POST /catalog/products</c> (rate limited, 201 / 409 <c>product_exists</c>), <c>GET /catalog/substances?q=</c> and
    /// <c>GET /catalog/substances/{substanceId}/products?offset=&amp;limit=</c> (paged, 404 <c>substance_not_found</c>).
    /// Reads count against the global per-user rate limit.
    /// </summary>
    public static IEndpointRouteBuilder MapCatalogEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        var catalog = api.MapGroup(CatalogPath);
        catalog.MapGet(ProductsPath, SearchProductsAsync)
            .WithName("SearchCatalogProducts")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        catalog.MapGet(ProductPath, GetProductAsync)
            .WithName("GetCatalogProduct")
            .ProducesProblem(StatusCodes.Status404NotFound);
        catalog.MapPost(ProductsPath, CreateProductAsync)
            .RequireRateLimiting(RequestLimitPolicies.CatalogWrite)
            .WithName("CreateCatalogProduct")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        catalog.MapGet(SubstancesPath, SearchSubstancesAsync)
            .WithName("SearchCatalogSubstances")
            .ProducesProblem(StatusCodes.Status400BadRequest);
        catalog.MapGet(SubstanceProductsPath, ListSubstanceProductsAsync)
            .WithName("ListCatalogSubstanceProducts")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status404NotFound);
        return api;
    }

    private static async Task<Ok<SubstanceProductsResponse>> ListSubstanceProductsAsync(Guid substanceId, int? offset, int? limit, ICatalogService catalog, CancellationToken cancellationToken) =>
        TypedResults.Ok(await catalog.ListProductsWithSubstanceAsync(substanceId, offset, limit, cancellationToken));

    private static async Task<Ok<IReadOnlyList<ProductSearchResult>>> SearchProductsAsync(string? q, int? limit, ICatalogService catalog, CancellationToken cancellationToken) =>
        TypedResults.Ok(await catalog.SearchProductsAsync(q, limit, cancellationToken));

    private static async Task<Ok<ProductResponse>> GetProductAsync(Guid productId, ICatalogService catalog, CancellationToken cancellationToken) =>
        TypedResults.Ok(await catalog.GetProductAsync(productId, cancellationToken));

    private static async Task<Ok<IReadOnlyList<SubstanceResponse>>> SearchSubstancesAsync(string? q, ICatalogService catalog, CancellationToken cancellationToken) =>
        TypedResults.Ok(await catalog.SearchSubstancesAsync(q, cancellationToken));

    private static async Task<Results<Created<ProductResponse>, ProblemHttpResult>> CreateProductAsync(
        CreateProductRequest request,
        ICatalogService catalog,
        CancellationToken cancellationToken)
    {
        var result = await catalog.CreateProductAsync(request, cancellationToken);
        return result.Created
            ? TypedResults.Created($"{ApiEndpoints.V1Prefix}{CatalogPath}{ProductsPath}/{result.Product.Id}", result.Product)
            : ProductExists(result.Product);
    }

    private static ProblemHttpResult ProductExists(ProductResponse existing) => TypedResults.Problem(
        statusCode: StatusCodes.Status409Conflict,
        detail: "A product with the same normalized name, form and country already exists; link it instead.",
        extensions: new Dictionary<string, object?>
        {
            [DomainExceptionHandler.CodeExtension] = ProductExistsCode,
            [ProductExtension] = existing,
        });
}
