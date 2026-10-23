using Lotties.Application.Appointments;
using Lotties.Application.CareProviders;
using Lotties.Application.Events;
using Lotties.Application.EventTypes;
using Lotties.Application.Formulas;
using Lotties.Application.Measurements;
using Lotties.Application.Medications;
using Lotties.Application.Notes;
using Lotties.Application.Prescriptions;
using Lotties.Application.Vaccinations;
using Lotties.Domain.Backups;
using Lotties.Domain.Events;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.Backups;

/// <summary>What applying a backup to a baby did (or, rolled back, would do).</summary>
internal sealed record BackupApplication(
    IReadOnlyDictionary<string, BackupKindCounts> Kinds,
    IReadOnlyList<BackupIssue> Issues,
    int IssueCount,
    IReadOnlyList<BackupNotice> Notices);

/// <summary>
/// Applies the records of a backup to one baby through the same application services the app's own writes use, so every
/// record meets the validators, the role checks and the sync contract of a normal write (last write wins on the client
/// edit time, deleted stays deleted, a record of another baby is refused). The caller owns the transaction
/// (<see cref="IBackupSession"/>): a preview rolls it back, an import commits it. Nothing existing is ever deleted or
/// overwritten by an older copy; where the existing record wins it is counted as kept. See docs/design/24-export-import.md.
/// </summary>
internal sealed partial class BackupApplier
{
    /// <summary>How many invalid records a report lists; the count of all of them is always given.</summary>
    public const int MaxIssues = 50;

    private const int EventPageSize = 500;

    private readonly IEventTypeService _eventTypes;
    private readonly IMedicationService _medications;
    private readonly IPrescriptionService _prescriptions;
    private readonly IFormulaService _formulas;
    private readonly ICareProviderService _careProviders;
    private readonly IAppointmentService _appointments;
    private readonly IVaccinationService _vaccinations;
    private readonly IMeasurementService _measurements;
    private readonly INoteService _notes;
    private readonly IEventService _events;
    private readonly IBackupSession _session;

    public BackupApplier(
        IEventTypeService eventTypes,
        IMedicationService medications,
        IPrescriptionService prescriptions,
        IFormulaService formulas,
        ICareProviderService careProviders,
        IAppointmentService appointments,
        IVaccinationService vaccinations,
        IMeasurementService measurements,
        INoteService notes,
        IEventService events,
        IBackupSession session)
    {
        _eventTypes = eventTypes ?? throw new ArgumentNullException(nameof(eventTypes));
        _medications = medications ?? throw new ArgumentNullException(nameof(medications));
        _prescriptions = prescriptions ?? throw new ArgumentNullException(nameof(prescriptions));
        _formulas = formulas ?? throw new ArgumentNullException(nameof(formulas));
        _careProviders = careProviders ?? throw new ArgumentNullException(nameof(careProviders));
        _appointments = appointments ?? throw new ArgumentNullException(nameof(appointments));
        _vaccinations = vaccinations ?? throw new ArgumentNullException(nameof(vaccinations));
        _measurements = measurements ?? throw new ArgumentNullException(nameof(measurements));
        _notes = notes ?? throw new ArgumentNullException(nameof(notes));
        _events = events ?? throw new ArgumentNullException(nameof(events));
        _session = session ?? throw new ArgumentNullException(nameof(session));
    }

    public async Task<BackupApplication> ApplyAsync(Guid babyId, BackupFile file, bool babyExists, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(file);
        var run = new Run(this, babyId, file, cancellationToken);
        await run.ExecuteAsync(babyExists);
        return run.Result();
    }

    private enum Outcome
    {
        New,
        Unchanged,
        Updated,
        Kept,
    }

    /// <summary>What the baby holds now for one record: the sync times and whether it is deleted.</summary>
    private sealed record Prior(DateTimeOffset UpdatedAt, DateTimeOffset ClientUpdatedAt, bool Deleted);

    private sealed class Tally
    {
        public int Total { get; set; }

        public int New { get; set; }

        public int Unchanged { get; set; }

        public int Updated { get; set; }

        public int Kept { get; set; }

        public int Invalid { get; set; }

        public BackupKindCounts ToCounts() => new() { Total = Total, New = New, Unchanged = Unchanged, Updated = Updated, Kept = Kept, Invalid = Invalid };
    }

    private sealed partial class Run(BackupApplier owner, Guid babyId, BackupFile file, CancellationToken cancellationToken)
    {
        private readonly Guid _sourceBabyId = file.Baby!.Id;
        private readonly Dictionary<string, Tally> _tallies = BackupFile.SectionOrder.Where(section => section != "baby").ToDictionary(section => section, _ => new Tally());
        private readonly Dictionary<string, Dictionary<Guid, Prior>> _priors = [];
        private readonly Dictionary<Guid, Guid> _eventTypeMap = [];
        private readonly Dictionary<string, int> _notices = [];
        private readonly List<BackupIssue> _issues = [];
        private int _issueCount;

        public async Task ExecuteAsync(bool babyExists)
        {
            await EventTypesAsync(babyExists);
            await MedicationsAsync(babyExists);
            await PrescriptionsAsync(babyExists);
            await FormulasAsync(babyExists);
            await CareProvidersAsync(babyExists);
            await AppointmentsAsync(babyExists);
            await VaccinationsAsync(babyExists);
            await MeasurementsAsync(babyExists);
            await NotesAsync(babyExists);
            await EventsAsync(babyExists);
        }

        public BackupApplication Result() => new(
            _tallies.ToDictionary(tally => tally.Key, tally => tally.Value.ToCounts()),
            _issues,
            _issueCount,
            _notices.Where(notice => notice.Value > 0).Select(notice => new BackupNotice { Code = notice.Key, Count = notice.Value }).ToArray());

        /// <summary>The id a record of the file has in the target baby (see <see cref="BackupIds.Record"/>).</summary>
        private Guid Target(string kind, Guid sourceId) => BackupIds.Record(babyId, _sourceBabyId, kind, sourceId);

        private Prior? PriorOf(string kind, Guid id) =>
            _priors.TryGetValue(kind, out var priors) && priors.TryGetValue(id, out var prior) ? prior : null;

        private void SetPriors(string kind, IEnumerable<(Guid Id, Prior Prior)> found) =>
            _priors[kind] = found.ToDictionary(item => item.Id, item => item.Prior);

        private void Notice(string code, int count = 1) => _notices[code] = _notices.GetValueOrDefault(code) + count;

        /// <summary>Counts every record of <paramref name="section"/>; an invalid one is listed and counted, never fatal to the others (the import as a whole is refused at the end).</summary>
        private async Task StepAsync<T>(string section, IReadOnlyList<T>? records, Func<T, Guid> idOf, Func<T, Task<Outcome>> apply, Func<T, IEnumerable<string>>? notices = null)
        {
            var tally = _tallies[section];
            foreach (var record in records ?? [])
            {
                cancellationToken.ThrowIfCancellationRequested();
                tally.Total++;
                try
                {
                    var outcome = await apply(record);
                    Count(tally, outcome);
                    NoteOutcome(outcome, record, notices);
                }
                catch (NoteNotOwnedException)
                {
                    tally.Kept++;
                }
                catch (DomainException exception)
                {
                    tally.Invalid++;
                    AddIssue(section, idOf(record), exception);
                }
                finally
                {
                    owner._session.ReleaseTrackedEntities();
                }
                // The next record starts from an empty change tracker.
            }
        }

        private void NoteOutcome<T>(Outcome outcome, T record, Func<T, IEnumerable<string>>? notices)
        {
            if (notices is not null && outcome is Outcome.New or Outcome.Updated)
            {
                notices(record).ToList().ForEach(code => Notice(code));
            }
        }

        private static void Count(Tally tally, Outcome outcome)
        {
            switch (outcome)
            {
                case Outcome.New:
                    tally.New++;
                    break;
                case Outcome.Updated:
                    tally.Updated++;
                    break;
                case Outcome.Kept:
                    tally.Kept++;
                    break;
                default:
                    tally.Unchanged++;
                    break;
            }
        }

        private void AddIssue(string section, Guid id, DomainException exception)
        {
            _issueCount++;
            if (_issues.Count < MaxIssues)
            {
                _issues.Add(new BackupIssue
                {
                    Kind = section,
                    Id = id,
                    Code = exception.Code,
                    Message = exception.Message,
                    Field = (exception as DomainValidationException)?.Field,
                });
            }
        }

        /// <summary>The outcome decided by the deleted flags alone, or <c>null</c> when the record is to be written.</summary>
        private static Outcome? DeletedOutcome(bool deletedInFile, Prior? before) => (deletedInFile, before) switch
        {
            (true, { Deleted: false }) => Outcome.Kept,
            (true, { Deleted: true }) => Outcome.Unchanged,
            _ => null,
        };

        private static Outcome Classify(Prior? before, bool created, DateTimeOffset storedUpdatedAt, DateTimeOffset fileClientUpdatedAt)
        {
            if (before is null || created)
            {
                return Outcome.New;
            }

            if (storedUpdatedAt != before.UpdatedAt)
            {
                return Outcome.Updated;
            }

            return fileClientUpdatedAt < before.ClientUpdatedAt ? Outcome.Kept : Outcome.Unchanged;
        }

        private IEnumerable<string> AuthorNotice(Guid author) =>
            author != file.ExportedBy ? ["authors_remapped"] : [];
    }
}
