using System.Reflection;
using System.Text.Json;
using Lotties.Application.Appointments;
using Lotties.Application.Babies;
using Lotties.Application.CareProviders;
using Lotties.Application.Events;
using Lotties.Application.EventTypes;
using Lotties.Application.Formulas;
using Lotties.Application.Measurements;
using Lotties.Application.Medications;
using Lotties.Application.Notes;
using Lotties.Application.Prescriptions;
using Lotties.Application.Professionals;
using Lotties.Application.Users;
using Lotties.Application.Vaccinations;
using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.Exceptions;
using Microsoft.Extensions.Logging;
using BackupIds = Lotties.Domain.Backups.BackupIds;

namespace Lotties.Application.Backups;

/// <summary>What an export wrote: the baby, when, and how many records of each section.</summary>
public sealed record BackupExportSummary(string BabyName, DateTimeOffset ExportedAt, IReadOnlyDictionary<string, int> Counts);

/// <summary>
/// Exports everything the app stores about one baby as a backup file (docs/design/24-export-import.md). The file is
/// built on the server from the same services the sync reads use, so it holds exactly what an Owner or a Parent sees
/// in the app; it is written as a stream, so a baby with a hundred thousand events never sits in memory. This is the
/// function to call for any "download my data" step (the account deletion's, for one): it writes the file to a stream.
/// </summary>
public interface IBackupExportService
{
    /// <summary>
    /// Writes the backup of <paramref name="babyId"/> to <paramref name="destination"/> as UTF-8 JSON (the caller
    /// compresses the stream when it wants a <c>.json.gz</c>). Only an Owner or a Parent may export
    /// (<see cref="BackupNotAllowedException"/>); the endpoints check it first.
    /// </summary>
    Task<BackupExportSummary> WriteAsync(Guid babyId, Stream destination, CancellationToken cancellationToken = default);
}

internal sealed class BackupExportService : IBackupExportService
{
    private const int EventPageSize = 500;

    private readonly IBabyAccessService _access;
    private readonly IBabyService _babies;
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
    private readonly IPersonDirectory _people;
    private readonly ICurrentUser _currentUser;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<BackupExportService> _logger;

    public BackupExportService(
        IBabyAccessService access,
        IBabyService babies,
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
        IPersonDirectory people,
        ICurrentUser currentUser,
        TimeProvider timeProvider,
        ILogger<BackupExportService> logger)
    {
        _access = access ?? throw new ArgumentNullException(nameof(access));
        _babies = babies ?? throw new ArgumentNullException(nameof(babies));
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
        _people = people ?? throw new ArgumentNullException(nameof(people));
        _currentUser = currentUser ?? throw new ArgumentNullException(nameof(currentUser));
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<BackupExportSummary> WriteAsync(Guid babyId, Stream destination, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(destination);
        await EnsureMayExportAsync(babyId, cancellationToken);
        var user = await _currentUser.GetUserAsync(cancellationToken);
        var baby = await _babies.GetAsync(babyId, cancellationToken);
        var exportedAt = _timeProvider.GetUtcNow();
        var authors = new AuthorBook(babyId);
        var exporter = authors.Of(user.Id);
        var counts = new Dictionary<string, int>();
        string checksum;

        await using (var writer = new Utf8JsonWriter(destination, BackupJson.WriterOptions))
        {
            using var digest = new BackupDigest(BackupFile.FormatName, BackupFile.CurrentSchemaVersion, exportedAt, exporter);
            var sections = new SectionWriter(writer, digest, counts);
            writer.WriteStartObject();
            WriteHeader(writer, exportedAt, exporter);
            sections.One("baby", ToBackupBaby(baby));
            sections.Many("eventTypes", await ListEventTypesAsync(babyId, cancellationToken));
            sections.Many("medications", await _medications.ListAsync(babyId, cancellationToken));
            sections.Many("prescriptions", (await _prescriptions.ListChangesAsync(babyId, null, cancellationToken)).Select(prescription => Anonymous(prescription, authors)));
            sections.Many("formulas", (await _formulas.ListChangesAsync(babyId, null, cancellationToken)).Select(formula => formula with { CreatedBy = authors.Of(formula.CreatedBy) }));
            sections.Many("careProviders", (await _careProviders.ListAsync(babyId, null, cancellationToken)).Select(provider => provider with { CreatedBy = authors.Of(provider.CreatedBy) }));
            sections.Many("appointments", (await _appointments.ListAsync(babyId, new AppointmentQuery(), cancellationToken)).Select(appointment => appointment with { CreatedBy = authors.Of(appointment.CreatedBy) }));
            sections.Many("vaccinations", (await _vaccinations.ListAsync(babyId, null, cancellationToken)).Select(vaccination => vaccination with { CreatedBy = authors.Of(vaccination.CreatedBy) }));
            sections.Many("measurements", (await _measurements.ListAsync(babyId, cancellationToken)).Select(measurement => measurement with { CreatedBy = authors.Of(measurement.CreatedBy), RecordedBy = null }));
            sections.Many("notes", (await _notes.ListChangesAsync(babyId, null, cancellationToken)).Select(note => note with { AuthorUserId = authors.Of(note.AuthorUserId), Author = null }));
            await WriteEventsAsync(babyId, sections, authors, cancellationToken);
            await WritePeopleAsync(writer, authors, cancellationToken);
            WriteCounts(writer, counts);
            checksum = digest.Finish();
            WriteChecksum(writer, checksum);
            writer.WriteEndObject();
            await writer.FlushAsync(cancellationToken);
        }

        _logger.LogInformation(
            "User {UserId} exported baby {BabyId}: {EventCount} events, {RecordCount} other records, checksum {Checksum}",
            user.Id,
            babyId,
            counts.GetValueOrDefault("events"),
            counts.Where(count => count.Key != "events").Sum(count => count.Value),
            checksum);
        return new BackupExportSummary(baby.Name, exportedAt, counts);
    }

    private async Task EnsureMayExportAsync(Guid babyId, CancellationToken cancellationToken)
    {
        var role = await _access.FindRoleAsync(babyId, cancellationToken) ?? throw new BabyNotFoundException(babyId);
        if (!role.CanWrite())
        {
            throw new BackupNotAllowedException(babyId);
        }
    }

    private async Task<IReadOnlyList<EventTypeResponse>> ListEventTypesAsync(Guid babyId, CancellationToken cancellationToken) =>
        (await _eventTypes.ListAsync(babyId, cancellationToken)).Where(eventType => eventType.BabyId is not null).ToArray();

    private async Task WriteEventsAsync(Guid babyId, SectionWriter sections, AuthorBook authors, CancellationToken cancellationToken)
    {
        sections.Begin("events");
        string? cursor = null;
        do
        {
            var page = await _events.ListChangesAsync(babyId, new ListEventChangesRequest(null, cursor, EventPageSize), cancellationToken);
            page.Items.ToList().ForEach(stored => sections.Item("events", ToBackupEvent(stored, authors)));
            await sections.FlushAsync(cancellationToken);
            cursor = page.NextCursor;
        }
        while (cursor is not null);
        sections.End("events");
    }

    private async Task WritePeopleAsync(Utf8JsonWriter writer, AuthorBook authors, CancellationToken cancellationToken)
    {
        var known = await _people.DescribeAsync(authors.UserIds, cancellationToken);
        writer.WriteStartArray("people");
        foreach (var userId in authors.UserIds)
        {
            var name = known.TryGetValue(userId, out var person) ? person.DisplayName : null;
            writer.WriteRawValue(BackupJson.Serialize(new BackupPerson { Id = authors.Of(userId), DisplayName = name }), skipInputValidation: true);
        }

        writer.WriteEndArray();
    }

    private static void WriteHeader(Utf8JsonWriter writer, DateTimeOffset exportedAt, Guid exporter)
    {
        writer.WriteString("format", BackupFile.FormatName);
        writer.WriteNumber("schemaVersion", BackupFile.CurrentSchemaVersion);
        writer.WriteString("exportedAt", exportedAt);
        writer.WritePropertyName("app");
        writer.WriteRawValue(BackupJson.Serialize(new BackupApp { Name = "Lotties", Version = AppVersion() }), skipInputValidation: true);
        writer.WriteString("exportedBy", exporter);
    }

    private static void WriteCounts(Utf8JsonWriter writer, Dictionary<string, int> counts)
    {
        writer.WriteStartObject("counts");
        BackupFile.SectionOrder.Where(counts.ContainsKey).ToList().ForEach(section => writer.WriteNumber(section, counts[section]));
        writer.WriteEndObject();
    }

    private static void WriteChecksum(Utf8JsonWriter writer, string checksum)
    {
        writer.WriteStartObject("checksum");
        writer.WriteString("algorithm", BackupChecksum.Sha256);
        writer.WriteString("value", checksum);
        writer.WriteEndObject();
    }

    private static string AppVersion()
    {
        var version = typeof(BackupFile).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        return version?.Split('+')[0] ?? "unknown";
    }

    private static BackupBaby ToBackupBaby(BabyResponse baby) => new()
    {
        Id = baby.Id,
        Name = baby.Name,
        BirthDate = baby.BirthDate,
        CreatedAt = baby.CreatedAt,
        VaccineProfile = baby.VaccineProfile,
        GestationalAgeWeeks = baby.GestationalAgeWeeks,
        RsvMaternalVaccination = baby.RsvMaternalVaccination,
    };

    private static BackupEvent ToBackupEvent(EventResponse stored, AuthorBook authors) => new()
    {
        Id = stored.Id,
        BabyId = stored.BabyId,
        TypeId = stored.TypeId,
        StartedAt = stored.StartedAt,
        EndedAt = stored.EndedAt,
        Payload = PayloadElement(stored),
        Notes = stored.Notes,
        CreatedBy = authors.Of(stored.CreatedBy),
        CreatedAt = stored.CreatedAt,
        UpdatedAt = stored.UpdatedAt,
        ClientUpdatedAt = stored.ClientUpdatedAt,
        DeletedAt = stored.DeletedAt,
    };

    private static JsonElement PayloadElement(EventResponse stored)
    {
        using var document = JsonDocument.Parse(stored.Payload.Value);
        return document.RootElement.Clone();
    }

    /// <summary>The prescription without the doctor's user id and the proposal it came from (the file names no other account).</summary>
    private static PrescriptionResponse Anonymous(PrescriptionResponse prescription, AuthorBook authors) => prescription with
    {
        CreatedBy = authors.Of(prescription.CreatedBy),
        PrescribedByUserId = prescription.PrescribedByUserId is { } doctor ? authors.Of(doctor) : null,
        PrescribedBy = null,
        ProposalId = null,
    };

    /// <summary>The stand-ins of the users met while writing, in the order they appeared.</summary>
    private sealed class AuthorBook(Guid babyId)
    {
        private readonly List<Guid> _userIds = [];

        public IReadOnlyCollection<Guid> UserIds => _userIds;

        public Guid Of(Guid userId)
        {
            if (!_userIds.Contains(userId))
            {
                _userIds.Add(userId);
            }

            return BackupIds.Author(babyId, userId);
        }
    }

    /// <summary>Writes the sections: one record per line, each also fed to the checksum.</summary>
    private sealed class SectionWriter(Utf8JsonWriter writer, BackupDigest digest, Dictionary<string, int> counts)
    {
        public void One(string name, object record)
        {
            writer.WritePropertyName(name);
            digest.Section(name);
            Write(name, record);
        }

        public void Many(string name, IEnumerable<object> records)
        {
            Begin(name);
            records.ToList().ForEach(record => Item(name, record));
            End(name);
        }

        public void Begin(string name)
        {
            writer.WriteStartArray(name);
            digest.Section(name);
            counts[name] = 0;
        }

        public void Item(string name, object record) => Write(name, record);

        public void End(string name)
        {
            _ = name;
            writer.WriteEndArray();
        }

        public Task FlushAsync(CancellationToken cancellationToken) => writer.FlushAsync(cancellationToken);

        private void Write(string name, object record)
        {
            var json = BackupJson.Serialize(record);
            digest.Record(json);
            writer.WriteRawValue(json, skipInputValidation: true);
            counts[name] = counts.GetValueOrDefault(name) + 1;
        }
    }
}
