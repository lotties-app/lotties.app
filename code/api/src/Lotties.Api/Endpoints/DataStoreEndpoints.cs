using Lotties.Api.Authorization;
using Lotties.Api.Limits;
using Lotties.Api.Stores;
using Lotties.Application.Stores;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// The Owner's management of a baby's data store (docs/design/47-bring-your-own-database.md, task T6), under
/// <c>/babies/{babyId}/data-store</c>. Every route needs the Owner (<see cref="BabyPolicies.ManageMembers"/>; a Doctor is refused by
/// role, whatever her scopes), answers 404 while <c>Stores:Enabled</c> is off (<see cref="DataStoreRequestGuard"/>, before any 401)
/// and to an account that is not on <c>Stores:Allowlist</c> (<see cref="DataStoreAllowlistFilter"/>), is behind the consent gate, and
/// is blocked in the try-it demo. These routes do not bind the baby to its store (no <c>StoreScopeEndpointFilter</c>): the owner
/// must reach them while the store is down. Request bodies are never logged (they hold passwords) and responses never carry a host,
/// a user name, a database name, a password or a CA.
/// </summary>
internal static class DataStoreEndpoints
{
    public const string Path = "/data-store";

    /// <summary>
    /// Maps <c>GET</c>, <c>PUT</c> and <c>DELETE /data-store</c>, <c>POST /data-store/test</c> (rate limited
    /// <see cref="RequestLimitPolicies.DataStoreTest"/>) and <c>POST /data-store/move-in</c>, <c>/move-out</c> (501 until task T7); the
    /// <c>PUT</c> and the moves are rate limited <see cref="RequestLimitPolicies.DataStoreWrite"/>.
    /// </summary>
    public static IEndpointRouteBuilder MapDataStoreEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        var store = api.MapGroup(BabyRoutes.Prefix)
            .RequireAuthorization(BabyPolicies.ManageMembers)
            .WithMetadata(DataStoreEndpointMetadata.Instance)
            .AddEndpointFilter(DataStoreAllowlistFilter.CheckAsync);
        store.MapGet(Path, GetAsync)
            .WithName("GetDataStore")
            .ProducesProblem(StatusCodes.Status403Forbidden);
        store.MapPut(Path, SaveAsync)
            .WithName("SaveDataStore")
            .RequireRateLimiting(RequestLimitPolicies.DataStoreWrite)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        store.MapDelete(Path, RemoveAsync)
            .WithName("RemoveDataStore")
            .ProducesProblem(StatusCodes.Status409Conflict);
        store.MapPost(Path + "/test", TestAsync)
            .WithName("TestDataStore")
            .RequireRateLimiting(RequestLimitPolicies.DataStoreTest)
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status409Conflict);
        store.MapPost(Path + "/move-in", MoveInAsync)
            .WithName("MoveIntoDataStore")
            .RequireRateLimiting(RequestLimitPolicies.DataStoreWrite)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status501NotImplemented);
        store.MapPost(Path + "/move-out", MoveOutAsync)
            .WithName("MoveOutOfDataStore")
            .RequireRateLimiting(RequestLimitPolicies.DataStoreWrite)
            .ProducesProblem(StatusCodes.Status501NotImplemented);
        return api;
    }

    private static async Task<Ok<DataStoreStatusResponse>> GetAsync(Guid babyId, IDataStoreService stores, CancellationToken cancellationToken) =>
        TypedResults.Ok(await stores.GetAsync(babyId, cancellationToken));

    private static async Task<Ok<DataStoreStatusResponse>> SaveAsync(Guid babyId, SaveDataStoreRequest request, IDataStoreService stores, CancellationToken cancellationToken) =>
        TypedResults.Ok(await stores.SaveAsync(babyId, request, cancellationToken));

    private static async Task<NoContent> RemoveAsync(Guid babyId, IDataStoreService stores, CancellationToken cancellationToken)
    {
        await stores.RemoveAsync(babyId, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<Ok<DataStoreTestResponse>> TestAsync(Guid babyId, IDataStoreService stores, CancellationToken cancellationToken) =>
        TypedResults.Ok(await stores.TestAsync(babyId, cancellationToken));

    private static async Task<NoContent> MoveInAsync(Guid babyId, IDataStoreService stores, CancellationToken cancellationToken)
    {
        await stores.MoveInAsync(babyId, cancellationToken);
        return TypedResults.NoContent();
    }

    private static async Task<NoContent> MoveOutAsync(Guid babyId, IDataStoreService stores, CancellationToken cancellationToken)
    {
        await stores.MoveOutAsync(babyId, cancellationToken);
        return TypedResults.NoContent();
    }
}
