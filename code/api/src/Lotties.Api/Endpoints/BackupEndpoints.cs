using System.Globalization;
using System.IO.Compression;
using System.Text;
using Lotties.Api.Authorization;
using Lotties.Api.Limits;
using Lotties.Application.Babies;
using Lotties.Application.Backups;
using Microsoft.AspNetCore.Http.HttpResults;

namespace Lotties.Api.Endpoints;

/// <summary>
/// Export and import of a baby's data (docs/design/24-export-import.md). Export and merge are baby routes that need
/// <see cref="BabyPolicies.Write"/> (Owner, Parent): a Caregiver, a Viewer and a Doctor are refused. Restoring into a new baby
/// needs only a signed-in user (she becomes its Owner). The import bodies are the backup file itself (plain JSON or
/// gzip, not JSON-wrapped) and use the import limits (<see cref="RequestLimitPolicies.WithImportLimits"/>).
/// </summary>
internal static class BackupEndpoints
{
    private const string GzipContentType = "application/gzip";
    private const string JsonContentType = "application/json";

    /// <summary>
    /// Maps, under the baby-scoped group: <c>GET /export?compress=true|false</c> (the backup file as a download),
    /// <c>POST /import/backup/preview</c> and <c>POST /import/backup</c> (merge into this baby, 200 with the report).
    /// </summary>
    public static RouteGroupBuilder MapBackupEndpoints(this RouteGroupBuilder baby)
    {
        ArgumentNullException.ThrowIfNull(baby);
        baby.MapGet("/export", ExportAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("ExportBaby")
            .WithImportLimits();
        baby.MapPost("/import/backup/preview", PreviewMergeAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("PreviewBackupMerge")
            .WithImportLimits()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        baby.MapPost("/import/backup", MergeAsync)
            .RequireAuthorization(BabyPolicies.Write)
            .WithName("MergeBackup")
            .WithImportLimits()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        return baby;
    }

    /// <summary>Maps, under the API group: <c>POST /babies/import/preview</c> and <c>POST /babies/import</c> (restore into a new baby).</summary>
    public static IEndpointRouteBuilder MapBackupRestoreEndpoints(this IEndpointRouteBuilder api)
    {
        ArgumentNullException.ThrowIfNull(api);
        api.MapPost("/babies/import/preview", PreviewRestoreAsync)
            .WithName("PreviewBackupRestore")
            .WithImportLimits()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        api.MapPost("/babies/import", RestoreAsync)
            .WithName("RestoreBackup")
            .WithImportLimits()
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status422UnprocessableEntity);
        return api;
    }

    private static async Task<IResult> ExportAsync(Guid babyId, bool? compress, HttpContext http, IBabyService babies, IBackupExportService export, TimeProvider time, CancellationToken cancellationToken)
    {
        var baby = await babies.GetAsync(babyId, cancellationToken);
        var gzip = compress ?? true;
        var name = FileName(string.IsNullOrEmpty(baby.Name) ? Lotties.Domain.Babies.BabyLabels.Shown(baby.Label) : baby.Name, time.GetUtcNow(), gzip);
        http.Response.Headers.CacheControl = "no-store";
        return Results.Stream(
            async stream =>
            {
                if (!gzip)
                {
                    await export.WriteAsync(babyId, stream, cancellationToken);
                    return;
                }

                await using var compressed = new GZipStream(stream, CompressionLevel.Fastest, leaveOpen: true);
                await export.WriteAsync(babyId, compressed, cancellationToken);
            },
            gzip ? GzipContentType : JsonContentType,
            name);
    }

    private static async Task<Ok<BackupImportReport>> PreviewMergeAsync(Guid babyId, HttpRequest request, IBackupImportService imports, CancellationToken cancellationToken) =>
        TypedResults.Ok(await imports.PreviewMergeAsync(babyId, request.Body, cancellationToken));

    private static async Task<Ok<BackupImportReport>> MergeAsync(Guid babyId, HttpRequest request, IBackupImportService imports, CancellationToken cancellationToken) =>
        TypedResults.Ok(await imports.MergeAsync(babyId, request.Body, cancellationToken));

    private static async Task<Ok<BackupImportReport>> PreviewRestoreAsync(HttpRequest request, IBackupImportService imports, CancellationToken cancellationToken) =>
        TypedResults.Ok(await imports.PreviewRestoreAsync(request.Body, cancellationToken));

    private static async Task<Ok<BackupImportReport>> RestoreAsync(HttpRequest request, IBackupImportService imports, CancellationToken cancellationToken) =>
        TypedResults.Ok(await imports.RestoreAsync(request.Body, cancellationToken));

    /// <summary><c>lotties-backup-&lt;name&gt;-&lt;yyyyMMdd&gt;.json[.gz]</c> with the baby's name reduced to ASCII letters and digits.</summary>
    private static string FileName(string babyName, DateTimeOffset now, bool gzip)
    {
        var slug = new StringBuilder();
        foreach (var letter in babyName.Normalize(NormalizationForm.FormD))
        {
            if (char.IsAsciiLetterOrDigit(letter))
            {
                slug.Append(char.ToLowerInvariant(letter));
            }
            else if (CharUnicodeInfo.GetUnicodeCategory(letter) != UnicodeCategory.NonSpacingMark && slug.Length > 0 && slug[^1] != '-')
            {
                slug.Append('-');
            }
        }

        var name = slug.ToString().Trim('-');
        var middle = name.Length == 0 ? string.Empty : "-" + name[..Math.Min(name.Length, 40)];
        return $"lotties-backup{middle}-{now:yyyyMMdd}.json{(gzip ? ".gz" : string.Empty)}";
    }
}
