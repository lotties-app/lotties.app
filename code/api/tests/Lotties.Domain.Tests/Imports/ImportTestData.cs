using System.Text.Json;
using Lotties.Domain.Events;
using Lotties.Domain.Imports;
using Lotties.Domain.Medications;

namespace Lotties.Domain.Tests.Imports;

internal static class ImportTestData
{
    public static readonly Guid BabyId = new("0f8b6a52-8c1e-4d5e-9d1a-2a7c3b4e5f60");
    public static readonly Guid UserId = new("1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d");
    public static readonly DateTimeOffset Offset = new(2025, 9, 1, 8, 0, 0, TimeSpan.FromHours(-3));

    public static NapperLogRow Row(string category, DateTimeOffset? start = null, DateTimeOffset? end = null, int rowNumber = 1) => new()
    {
        RowNumber = rowNumber,
        Category = category,
        Start = start ?? Offset,
        End = end ?? start ?? Offset,
    };

    public static Medication CatalogMedication(string name) => Medication.Create(BabyId, name, null, null, isUsual: false, TestClock.Now);

    public static MedicationResolver Resolver(IReadOnlyList<Medication>? catalog = null, params MedicationMapping[] mappings) =>
        MedicationResolver.Create(BabyId, catalog ?? [], mappings, TestClock.Now);

    public static NapperImportContext Context(MedicationResolver? resolver = null, IReadOnlySet<string>? categories = null) =>
        new(BabyId, UserId, TestClock.Now, resolver ?? Resolver(), categories);

    public static JsonElement Json(EventPayload payload) => JsonDocument.Parse(payload.Value).RootElement.Clone();

    public static string? Text(EventPayload payload, string key) =>
        Json(payload).TryGetProperty(key, out var value) ? value.ToString() : null;
}
