using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Imports;

/// <summary>
/// The event a Napper row maps to, before it gets an id and is validated as an <see cref="Event"/>. Instant types
/// have <see cref="EndedAt"/> equal to <see cref="StartedAt"/>. Medicine rows carry their medication names in
/// <see cref="MedicationTokens"/>; their payload is built once the tokens are resolved against the catalog.
/// <see cref="SkippedFields"/> are detail values the mapping could not use (kept as notes lines instead); they do not
/// take part in duplicate detection.
/// </summary>
public sealed record NapperEventDraft(
    NapperLogRow Source,
    EventType Type,
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    EventPayload Payload,
    string? Notes,
    IReadOnlyList<string> MedicationTokens)
{
    public IReadOnlyList<ImportSkippedField> SkippedFields { get; init; } = [];

    /// <summary>Equal for two rows that would create exactly the same event.</summary>
    internal string ContentKey =>
        string.Join('\u001f', Type.Id, StartedAt.UtcTicks, EndedAt.UtcTicks, Payload.Value, Notes, string.Join('\u001e', MedicationTokens));
}

/// <summary>The result of mapping one Napper row: a <see cref="Draft"/> or the reason it is skipped.</summary>
public sealed record NapperRowOutcome
{
    private NapperRowOutcome(NapperEventDraft? draft, ImportSkippedRow? skip)
    {
        Draft = draft;
        Skip = skip;
    }

    public NapperEventDraft? Draft { get; }

    public ImportSkippedRow? Skip { get; }

    public static NapperRowOutcome Mapped(NapperEventDraft draft) => new(draft, null);

    public static NapperRowOutcome Skipped(NapperLogRow row, string code, string reason) =>
        new(null, new ImportSkippedRow(row.RowNumber, row.Category, code, reason));
}
