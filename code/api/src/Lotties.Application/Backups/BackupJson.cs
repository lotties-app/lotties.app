using System.Globalization;
using System.Security.Cryptography;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Lotties.Application.Backups;

/// <summary>How the records of a backup are written and read: camelCase, no nulls, readable (non-ASCII text stays as it is).</summary>
internal static class BackupJson
{
    public const int MaxDepth = 32;

    public static JsonSerializerOptions Options { get; } = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        MaxDepth = MaxDepth,
    };

    public static JsonWriterOptions WriterOptions { get; } = new() { Indented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    /// <summary>The compact JSON of one record: what the file holds on one line and what the checksum covers.</summary>
    public static byte[] Serialize(object record)
    {
        ArgumentNullException.ThrowIfNull(record);
        return JsonSerializer.SerializeToUtf8Bytes(record, record.GetType(), Options);
    }
}

/// <summary>
/// The checksum of a backup: SHA-256 over a header line (format, schema version, export time, exporter) and, for each
/// section in <see cref="BackupFile.SectionOrder"/>, a <c>#section</c> line and the compact JSON of each record followed by a
/// newline. The exporter feeds it as it writes; the importer feeds it with the records it read, written again by
/// <see cref="BackupJson.Serialize"/>, so a changed, missing, added or reordered record changes the value.
/// </summary>
internal sealed class BackupDigest : IDisposable
{
    private static readonly byte[] LineEnd = "\n"u8.ToArray();

    private readonly IncrementalHash _hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);

    public BackupDigest(string? format, int schemaVersion, DateTimeOffset exportedAt, Guid exportedBy) =>
        AppendLine(string.Create(CultureInfo.InvariantCulture, $"{format}|{schemaVersion}|{exportedAt.UtcDateTime:O}|{exportedBy:N}"));

    public static string Of(BackupFile file)
    {
        ArgumentNullException.ThrowIfNull(file);
        using var digest = new BackupDigest(file.Format, file.SchemaVersion, file.ExportedAt, file.ExportedBy);
        foreach (var section in BackupFile.SectionOrder)
        {
            digest.Section(section);
            file.Records(section).ToList().ForEach(record => digest.Record(BackupJson.Serialize(record)));
        }

        return digest.Finish();
    }

    public void Section(string name) => AppendLine("#" + name);

    public void Record(byte[] json)
    {
        _hash.AppendData(json);
        _hash.AppendData(LineEnd);
    }

    public string Finish() => Convert.ToHexString(_hash.GetHashAndReset()).ToLowerInvariant();

    public void Dispose() => _hash.Dispose();

    private void AppendLine(string text)
    {
        _hash.AppendData(System.Text.Encoding.UTF8.GetBytes(text));
        _hash.AppendData(LineEnd);
    }
}
