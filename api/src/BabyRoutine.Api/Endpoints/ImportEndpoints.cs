using BabyRoutine.Api.Authorization;
using BabyRoutine.Application.Imports;
using Microsoft.AspNetCore.Http.HttpResults;

namespace BabyRoutine.Api.Endpoints;

/// <summary>
/// Napper CSV import of one baby, in two phases so the user stays in control: a preview that writes nothing, then the
/// import of the same request plus medication mappings. Both need <see cref="BabyPolicies.Write"/> (Parent/Owner).
/// </summary>
internal static class ImportEndpoints
{
    private const string NapperPath = "/import/napper";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>POST /import/napper/preview</c> (200, report) and <c>POST /import/napper</c>
    /// (200, counts). Bodies are JSON (<see cref="NapperImportRequest"/>) with the CSV texts.
    /// </summary>
    public static RouteGroupBuilder MapImportEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapPost(NapperPath + "/preview", PreviewAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("PreviewNapperImport")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        baby.MapPost(NapperPath, ImportAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("ImportNapper")
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        return baby;
    }

    private static async Task<Ok<NapperImportPreviewResponse>> PreviewAsync(Guid babyId, NapperImportRequest request, INapperImportService imports, CancellationToken cancellationToken) =>
        TypedResults.Ok(await imports.PreviewAsync(babyId, request, cancellationToken));

    private static async Task<Ok<NapperImportResponse>> ImportAsync(Guid babyId, NapperImportRequest request, INapperImportService imports, CancellationToken cancellationToken) =>
        TypedResults.Ok(await imports.ImportAsync(babyId, request, cancellationToken));
}
