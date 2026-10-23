using System.IO.Compression;
using System.Text.Json;
using Lotties.Domain.Exceptions;

namespace Lotties.Application.Backups;

/// <summary>
/// Reads and checks an uploaded backup before anything is imported: the bytes (plain JSON or gzip, size capped after
/// decompression), the format and schema version, the number of records of each section, the ids, the baby every record
/// names and the checksum. Whatever passes is still validated record by record by the normal services; this only
/// refuses a file that is not a backup, is too large, was damaged, or contradicts itself.
/// </summary>
internal static class BackupReader
{
    /// <summary>Largest accepted backup after decompression (a compressed upload is limited by the request limits).</summary>
    public const long MaxJsonBytes = 64L * 1024 * 1024;

    /// <summary>Largest number of events in a backup.</summary>
    public const int MaxEvents = 150_000;

    /// <summary>Largest number of records of any other section.</summary>
    public const int MaxOtherRecords = 20_000;

    /// <summary>Largest number of custom event types (the per-type field limits are the domain's).</summary>
    public const int MaxEventTypes = 200;

    private const int BufferSize = 81_920;

    public static async Task<BackupFile> ReadAsync(Stream input, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(input);
        var bytes = await ReadJsonBytesAsync(input, cancellationToken);
        var file = Parse(bytes);
        EnsureFormat(file);
        EnsureSizes(file);
        EnsureConsistent(file);
        EnsureChecksum(file);
        return file;
    }

    private static async Task<byte[]> ReadJsonBytesAsync(Stream input, CancellationToken cancellationToken)
    {
        var raw = await CopyLimitedAsync(input, MaxJsonBytes, cancellationToken);
        if (raw.Length < 2 || raw[0] != 0x1f || raw[1] != 0x8b)
        {
            return raw;
        }

        try
        {
            await using var gzip = new GZipStream(new MemoryStream(raw), CompressionMode.Decompress);
            return await CopyLimitedAsync(gzip, MaxJsonBytes, cancellationToken);
        }
        catch (InvalidDataException exception)
        {
            throw new InvalidBackupFileException("The file is not a valid .json.gz backup.", exception);
        }
    }

    private static async Task<byte[]> CopyLimitedAsync(Stream source, long max, CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[BufferSize];
        int read;
        while ((read = await source.ReadAsync(chunk, cancellationToken)) > 0)
        {
            if (buffer.Length + read > max)
            {
                throw new BackupTooLargeException("bytes (after decompression)", max);
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    private static BackupFile Parse(byte[] bytes)
    {
        try
        {
            return JsonSerializer.Deserialize<BackupFile>(bytes, BackupJson.Options)
                ?? throw new InvalidBackupFileException("The file is empty.");
        }
        catch (Exception exception) when (exception is JsonException or NotSupportedException or FormatException or ArgumentException or InvalidOperationException)
        {
            throw new InvalidBackupFileException("The file is not a Lotties backup: it could not be read as one.", exception);
        }
    }

    private static void EnsureFormat(BackupFile file)
    {
        if (!string.Equals(file.Format, BackupFile.FormatName, StringComparison.Ordinal))
        {
            throw new InvalidBackupFileException("The file is not a Lotties backup (its format is not \"" + BackupFile.FormatName + "\").");
        }

        if (file.SchemaVersion < 1)
        {
            throw new InvalidBackupFileException("The backup has no valid schema version.");
        }

        if (file.SchemaVersion > BackupFile.CurrentSchemaVersion)
        {
            throw new UnsupportedBackupVersionException(file.SchemaVersion, BackupFile.CurrentSchemaVersion);
        }

        if (file.Baby is null || file.Baby.Id == Guid.Empty)
        {
            throw new InvalidBackupFileException("The backup does not describe a baby.");
        }
    }

    private static void EnsureSizes(BackupFile file)
    {
        EnsureAtMost("events", file.Events?.Count ?? 0, MaxEvents);
        EnsureAtMost("event types", file.EventTypes?.Count ?? 0, MaxEventTypes);
        foreach (var section in BackupFile.SectionOrder.Where(section => section is not ("events" or "eventTypes" or "baby")))
        {
            EnsureAtMost(section, file.Records(section).Count, MaxOtherRecords);
        }
    }

    private static void EnsureAtMost(string what, int count, int max)
    {
        if (count > max)
        {
            throw new BackupTooLargeException(what, max);
        }
    }

    private static void EnsureConsistent(BackupFile file)
    {
        foreach (var section in BackupFile.SectionOrder)
        {
            var records = file.Records(section);
            EnsureCount(file, section, records.Count);
            if (section != "baby")
            {
                EnsureIdsAndBaby(file, section, records);
            }
        }
    }

    private static void EnsureCount(BackupFile file, string section, int actual)
    {
        if (file.Counts is null || !file.Counts.TryGetValue(section, out var declared) || declared != actual)
        {
            throw new InvalidBackupFileException($"The backup is incomplete or was edited: the count of \"{section}\" does not match its records.");
        }
    }

    private static void EnsureIdsAndBaby(BackupFile file, string section, IReadOnlyList<object> records)
    {
        var seen = new HashSet<Guid>();
        foreach (var record in records)
        {
            var (id, babyId) = IdsOf(record);
            if (id == Guid.Empty || !seen.Add(id))
            {
                throw new InvalidBackupFileException($"The backup has a record in \"{section}\" without an id, or with an id used twice.");
            }

            if (babyId != file.Baby!.Id)
            {
                throw new InvalidBackupFileException($"A record in \"{section}\" belongs to another baby than the one the backup describes.");
            }
        }
    }

    private static (Guid Id, Guid BabyId) IdsOf(object record) => record switch
    {
        EventTypes.EventTypeResponse eventType => (eventType.Id, eventType.BabyId ?? Guid.Empty),
        Medications.MedicationResponse medication => (medication.Id, medication.BabyId),
        Prescriptions.PrescriptionResponse prescription => (prescription.Id, prescription.BabyId),
        Formulas.FormulaResponse formula => (formula.Id, formula.BabyId),
        CareProviders.CareProviderResponse provider => (provider.Id, provider.BabyId),
        Appointments.AppointmentResponse appointment => (appointment.Id, appointment.BabyId),
        Vaccinations.VaccinationResponse vaccination => (vaccination.Id, vaccination.BabyId),
        Measurements.MeasurementResponse measurement => (measurement.Id, measurement.BabyId),
        Notes.NoteResponse note => (note.Id, note.BabyId),
        BackupEvent stored => (stored.Id, stored.BabyId),
        _ => throw new InvalidBackupFileException("The backup has a record of an unknown kind."),
    };

    private static void EnsureChecksum(BackupFile file)
    {
        if (file.Checksum is not { Algorithm: BackupChecksum.Sha256, Value: { Length: > 0 } value })
        {
            throw new InvalidBackupFileException("The backup has no checksum (sha256).");
        }

        if (!string.Equals(BackupDigest.Of(file), value, StringComparison.OrdinalIgnoreCase))
        {
            throw new BackupChecksumMismatchException();
        }
    }
}
