namespace BabyRoutine.Application.Imports;

/// <summary>Napper CSV import of one baby, in two phases. Callers have already authorized the current user for the baby.</summary>
public interface INapperImportService
{
    /// <summary>Parses and maps the exports and reports what the import would do; writes nothing.</summary>
    Task<NapperImportPreviewResponse> PreviewAsync(Guid babyId, NapperImportRequest request, CancellationToken cancellationToken = default);

    /// <summary>
    /// Imports what the preview of the same request reports as new, in one transaction. Throws
    /// <see cref="Domain.Exceptions.UnmappedMedicationsException"/> when a medication name of a new row has no mapping.
    /// Re-importing the same export creates nothing.
    /// </summary>
    Task<NapperImportResponse> ImportAsync(Guid babyId, NapperImportRequest request, CancellationToken cancellationToken = default);
}
