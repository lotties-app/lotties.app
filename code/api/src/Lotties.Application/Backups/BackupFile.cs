using System.Text.Json;
using System.Text.Json.Serialization;
using Lotties.Application.Appointments;
using Lotties.Application.CareProviders;
using Lotties.Application.EventTypes;
using Lotties.Application.Formulas;
using Lotties.Application.Measurements;
using Lotties.Application.Medications;
using Lotties.Application.Notes;
using Lotties.Application.Prescriptions;
using Lotties.Application.Serialization;
using Lotties.Application.Vaccinations;
using Lotties.Domain.Vaccinations;

namespace Lotties.Application.Backups;

/// <summary>
/// The backup file of one baby (docs/design/24-export-import.md): one JSON document, versioned, readable by a person.
/// The sections reuse the sync DTOs of the API (so the file says what the API says), except that a user is never
/// named by id: every <c>createdBy</c> / <c>authorUserId</c> is a stand-in (<see cref="Domain.Backups.BackupIds.Author"/>)
/// listed in <see cref="People"/>. Every property is optional on read: a missing section is an empty one, and unknown
/// properties are ignored, so a later version of the app may add to schema version 1 without breaking older readers.
/// </summary>
public sealed record BackupFile
{
    public const string FormatName = "lotties-backup";

    /// <summary>The newest schema version this build reads and writes.</summary>
    public const int CurrentSchemaVersion = 1;

    /// <summary>Sections in the order the checksum covers them and the importer applies them.</summary>
    public static readonly IReadOnlyList<string> SectionOrder =
    [
        "baby", "eventTypes", "medications", "prescriptions", "formulas", "careProviders", "appointments", "vaccinations", "measurements", "notes", "events",
    ];

    public string? Format { get; init; }

    public int SchemaVersion { get; init; }

    public DateTimeOffset ExportedAt { get; init; }

    public BackupApp? App { get; init; }

    /// <summary>The stand-in of the person who exported the file.</summary>
    public Guid ExportedBy { get; init; }

    public BackupBaby? Baby { get; init; }

    public IReadOnlyList<EventTypeResponse>? EventTypes { get; init; }

    public IReadOnlyList<MedicationResponse>? Medications { get; init; }

    public IReadOnlyList<PrescriptionResponse>? Prescriptions { get; init; }

    public IReadOnlyList<FormulaResponse>? Formulas { get; init; }

    public IReadOnlyList<CareProviderResponse>? CareProviders { get; init; }

    public IReadOnlyList<AppointmentResponse>? Appointments { get; init; }

    public IReadOnlyList<VaccinationResponse>? Vaccinations { get; init; }

    public IReadOnlyList<MeasurementResponse>? Measurements { get; init; }

    public IReadOnlyList<NoteResponse>? Notes { get; init; }

    public IReadOnlyList<BackupEvent>? Events { get; init; }

    public IReadOnlyList<BackupPerson>? People { get; init; }

    public IReadOnlyDictionary<string, int>? Counts { get; init; }

    public BackupChecksum? Checksum { get; init; }

    /// <summary>The records of <paramref name="section"/> in file order (empty when the section is missing).</summary>
    public IReadOnlyList<object> Records(string section) => section switch
    {
        "baby" => Baby is null ? [] : [Baby],
        "eventTypes" => Boxed(EventTypes),
        "medications" => Boxed(Medications),
        "prescriptions" => Boxed(Prescriptions),
        "formulas" => Boxed(Formulas),
        "careProviders" => Boxed(CareProviders),
        "appointments" => Boxed(Appointments),
        "vaccinations" => Boxed(Vaccinations),
        "measurements" => Boxed(Measurements),
        "notes" => Boxed(Notes),
        "events" => Boxed(Events),
        _ => throw new ArgumentOutOfRangeException(nameof(section), section, "Unknown backup section."),
    };

    private static IReadOnlyList<object> Boxed<T>(IReadOnlyList<T>? records)
        where T : notnull =>
        records is null ? [] : records.Cast<object>().ToArray();
}

/// <summary>Which app wrote the file.</summary>
public sealed record BackupApp
{
    public string? Name { get; init; }

    public string? Version { get; init; }
}

/// <summary>The baby's own profile: what restoring it into a new baby sets. No members, no invites.</summary>
public sealed record BackupBaby
{
    public Guid Id { get; init; }

    public string? Name { get; init; }

    /// <summary>Preset code or custom text (absent in files from before labels).</summary>
    public string? Label { get; init; }

    public DateOnly BirthDate { get; init; }

    /// <summary>Whether <see cref="BirthDate"/> is the Monday of the birth week (absent = exact date).</summary>
    public bool? BirthWeekOnly { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    /// <summary><c>public</c> or <c>public+private</c>.</summary>
    public string? VaccineProfile { get; init; }

    public int? GestationalAgeWeeks { get; init; }

    [JsonConverter(typeof(CamelCaseStringEnumConverter))]
    public RsvMaternalVaccination? RsvMaternalVaccination { get; init; }
}

/// <summary>An event as exported: the sync <c>EventDto</c> with the payload as a plain JSON object and the author as a stand-in.</summary>
public sealed record BackupEvent
{
    public Guid Id { get; init; }

    public Guid BabyId { get; init; }

    public Guid TypeId { get; init; }

    public DateTimeOffset StartedAt { get; init; }

    public DateTimeOffset? EndedAt { get; init; }

    public JsonElement? Payload { get; init; }

    public string? Notes { get; init; }

    public Guid CreatedBy { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public DateTimeOffset UpdatedAt { get; init; }

    public DateTimeOffset ClientUpdatedAt { get; init; }

    public DateTimeOffset? DeletedAt { get; init; }
}

/// <summary>A person who wrote something in the file, by stand-in id and the name the family knows her by.</summary>
public sealed record BackupPerson
{
    public Guid Id { get; init; }

    public string? DisplayName { get; init; }
}

/// <summary>SHA-256 over the records of the file (see <see cref="BackupDigest"/>).</summary>
public sealed record BackupChecksum
{
    public const string Sha256 = "sha256";

    public string? Algorithm { get; init; }

    public string? Value { get; init; }
}
