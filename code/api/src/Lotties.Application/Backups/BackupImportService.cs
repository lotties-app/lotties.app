using Lotties.Application.Babies;
using Lotties.Application.Users;
using Lotties.Domain.Babies;
using Lotties.Domain.Backups;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Vaccinations;
using Microsoft.Extensions.Logging;

namespace Lotties.Application.Backups;

/// <summary>
/// Imports a backup file (docs/design/24-export-import.md). Two modes, each in two phases: a preview that runs the whole
/// import and rolls it back (so it reports exactly what the import will do, with the validators of the normal writes),
/// then the import itself, which runs the same steps and commits only when every record was valid.
/// </summary>
public interface IBackupImportService
{
    /// <summary>What restoring the file into a new baby of the caller would do. Writes nothing.</summary>
    Task<BackupImportReport> PreviewRestoreAsync(Stream file, CancellationToken cancellationToken = default);

    /// <summary>
    /// Creates a baby owned by the caller from the file and imports everything into it. Importing the same file again
    /// adds to that baby instead of creating another (the baby's id derives from the caller and the file's baby).
    /// </summary>
    Task<BackupImportReport> RestoreAsync(Stream file, CancellationToken cancellationToken = default);

    /// <summary>What merging the file into <paramref name="babyId"/> would do (Owner or Parent). Writes nothing.</summary>
    Task<BackupImportReport> PreviewMergeAsync(Guid babyId, Stream file, CancellationToken cancellationToken = default);

    /// <summary>Adds the records of the file that the baby does not have, and applies the sync rules to the ones it has. Never deletes.</summary>
    Task<BackupImportReport> MergeAsync(Guid babyId, Stream file, CancellationToken cancellationToken = default);
}

internal sealed class BackupImportService : IBackupImportService
{
    private const string RestoreMode = "restore";
    private const string MergeMode = "merge";

    private readonly IBabyRepository _babies;
    private readonly IBabyAccessService _access;
    private readonly BackupApplier _applier;
    private readonly IBackupSession _session;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<BackupImportService> _logger;

    public BackupImportService(
        IBabyRepository babies,
        IBabyAccessService access,
        BackupApplier applier,
        IBackupSession session,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<BackupImportService> logger)
    {
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
        _access = access ?? throw new ArgumentNullException(nameof(access));
        _applier = applier ?? throw new ArgumentNullException(nameof(applier));
        _session = session ?? throw new ArgumentNullException(nameof(session));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public Task<BackupImportReport> PreviewRestoreAsync(Stream file, CancellationToken cancellationToken = default) =>
        RestoreCoreAsync(file, commit: false, cancellationToken);

    public Task<BackupImportReport> RestoreAsync(Stream file, CancellationToken cancellationToken = default) =>
        RestoreCoreAsync(file, commit: true, cancellationToken);

    public Task<BackupImportReport> PreviewMergeAsync(Guid babyId, Stream file, CancellationToken cancellationToken = default) =>
        MergeCoreAsync(babyId, file, commit: false, cancellationToken);

    public Task<BackupImportReport> MergeAsync(Guid babyId, Stream file, CancellationToken cancellationToken = default) =>
        MergeCoreAsync(babyId, file, commit: true, cancellationToken);

    private async Task<BackupImportReport> RestoreCoreAsync(Stream upload, bool commit, CancellationToken cancellationToken)
    {
        var file = await BackupReader.ReadAsync(upload, cancellationToken);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var babyId = BackupIds.RestoredBaby(user.Id, file.Baby!.Id);
        var existing = await _babies.FindAsync(babyId, cancellationToken);
        if (existing is not null && existing.FindMember(user.Id)?.Role.CanWrite() != true)
        {
            throw new BackupBabyUnavailableException();
        }

        await _session.BeginAsync(cancellationToken);
        try
        {
            if (existing is null && await TryCreateBabyAsync(babyId, file, user.Id, cancellationToken) is { } rejected)
            {
                await _session.RollbackAsync(CancellationToken.None);
                return rejected;
            }

            return await RunAsync(RestoreMode, babyId, file, babyExists: existing is not null, commit, cancellationToken);
        }
        catch
        {
            await _session.RollbackAsync(CancellationToken.None);
            throw;
        }
    }

    private async Task<BackupImportReport> MergeCoreAsync(Guid babyId, Stream upload, bool commit, CancellationToken cancellationToken)
    {
        var role = await _access.FindRoleAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);
        if (!role.CanWrite())
        {
            throw new BackupNotAllowedException(babyId);
        }

        var file = await BackupReader.ReadAsync(upload, cancellationToken);
        await _session.BeginAsync(cancellationToken);
        try
        {
            return await RunAsync(MergeMode, babyId, file, babyExists: true, commit, cancellationToken);
        }
        catch
        {
            await _session.RollbackAsync(CancellationToken.None);
            throw;
        }
    }

    /// <summary>Creates the baby of a restore with the file's profile; an invalid profile is reported as the single issue of the file.</summary>
    private async Task<BackupImportReport?> TryCreateBabyAsync(Guid babyId, BackupFile file, Guid ownerUserId, CancellationToken cancellationToken)
    {
        var profile = file.Baby!;
        try
        {
            var baby = Baby.Create(babyId, profile.Name, profile.BirthDate, ownerUserId, _timeProvider.GetUtcNow(), profile.Label, profile.BirthWeekOnly == true);
            baby.UpdateVaccineProfile(VaccineProfile.Create(VaccineProfile.CoverageOf(profile.VaccineProfile), profile.GestationalAgeWeeks, profile.RsvMaternalVaccination));
            await _babies.AddAsync(baby, cancellationToken);
            return null;
        }
        catch (DomainException exception)
        {
            var issue = new BackupIssue { Kind = "baby", Id = profile.Id, Code = exception.Code, Message = exception.Message, Field = (exception as DomainValidationException)?.Field };
            return Report(RestoreMode, babyId, file, babyExists: false, applied: false, new BackupApplication(new Dictionary<string, BackupKindCounts>(), [issue], 1, []));
        }
    }

    private async Task<BackupImportReport> RunAsync(string mode, Guid babyId, BackupFile file, bool babyExists, bool commit, CancellationToken cancellationToken)
    {
        var application = await _applier.ApplyAsync(babyId, file, babyExists || mode == MergeMode, cancellationToken);
        var importable = application.IssueCount == 0;
        if (!commit || !importable)
        {
            await _session.RollbackAsync(CancellationToken.None);
        }

        if (commit && !importable)
        {
            throw new BackupRejectedException(application.Issues.Select(IssueDetails).ToArray(), application.IssueCount);
        }

        if (commit)
        {
            await _session.CommitAsync(cancellationToken);
            _logger.LogInformation("Backup imported into baby {BabyId} ({Mode}): {Counts}", babyId, mode, Summary(application));
        }

        return Report(mode, babyId, file, babyExists, applied: commit, application);
    }

    private static BackupImportReport Report(string mode, Guid babyId, BackupFile file, bool babyExists, bool applied, BackupApplication application) => new()
    {
        Mode = mode,
        Applied = applied,
        CanImport = application.IssueCount == 0,
        BabyId = babyId,
        BabyExists = babyExists && mode == RestoreMode,
        Source = new BackupSource
        {
            ExportedAt = file.ExportedAt,
            SchemaVersion = file.SchemaVersion,
            AppVersion = file.App?.Version,
            BabyName = file.Baby!.Name,
            BirthDate = file.Baby.BirthDate,
        },
        Kinds = application.Kinds,
        Issues = application.Issues,
        IssueCount = application.IssueCount,
        Notices = application.Notices,
    };

    private static IReadOnlyDictionary<string, object?> IssueDetails(BackupIssue issue) => new Dictionary<string, object?>
    {
        ["kind"] = issue.Kind,
        ["id"] = issue.Id,
        ["code"] = issue.Code,
        ["message"] = issue.Message,
        ["field"] = issue.Field,
    };

    private static string Summary(BackupApplication application) =>
        string.Join(", ", application.Kinds.Select(kind => $"{kind.Key}: {kind.Value.New} new/{kind.Value.Updated} updated/{kind.Value.Unchanged} unchanged/{kind.Value.Kept} kept"));
}
