using System.Text.Json;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Predictions;

namespace Lotties.Domain.CommunityInsights;

/// <summary>
/// One stored event as the community loader receives it from the database (docs/design/34-community-insights.md section 5.3): its
/// type, start, end and payload, never its notes, author or id. It lives only until <see cref="CommunityEventRows.Read"/> has kept
/// the few facts the statistics need.
/// </summary>
public readonly record struct CommunityStoredEvent(Guid TypeId, DateTimeOffset StartedAt, DateTimeOffset? EndedAt, EventPayload Payload);

/// <summary>
/// A feeding of any method (it shows that the family logged feeds that day) and, only for a finished formula bottle with an amount,
/// the millilitres drunk (<see cref="BottleAmounts.DrunkMl"/>: the drunk amount, else the prepared one). Nothing else of the feed.
/// </summary>
public sealed record CommunityFeedRow(DateTimeOffset StartedAt, decimal? FormulaDrunkMl);

/// <summary>
/// A sleep session as the clinical summary counts it (<c>SleepObservation.IsSession</c>: a nap, a night or a sleep without a kind;
/// markers and night wakings are not sleep): its start, end (<c>null</c> while it runs), whether it is a night, and its finished
/// pauses. Nothing else of the sleep (no detail field).
/// </summary>
public sealed record CommunitySleepRow(DateTimeOffset StartedAt, DateTimeOffset? EndedAt, bool IsNight, int PausedSeconds);

/// <summary>A tummy time session: start, end (<c>null</c> while it runs) and finished pauses. Nothing else (no mood).</summary>
public sealed record CommunityTummyRow(DateTimeOffset StartedAt, DateTimeOffset? EndedAt, int PausedSeconds);

/// <summary>
/// An answered fussy spell (design 27 section 5: a <c>what_helped</c> answer, a false alarm excluded): its start and the cause that
/// helped (<see cref="CommunityCryCauses.FromWhatHelped"/>). Nothing else of the spell (no intensity, suggested cause or duration).
/// </summary>
public sealed record CommunitySpellRow(DateTimeOffset StartedAt, string Cause);

/// <summary>
/// The facts one run keeps of one baby's events (docs/design/34-community-insights.md section 5.3): only events of the four
/// built-in types the v1 statistics read (<see cref="ReadTypeIds"/>: feeding, sleep, tummy time, fussy; never a baby's own type,
/// never another kind), and of each only the members listed on the row records. The payload is parsed here and dropped: notes,
/// formula names, foods, moods and any other text never leave this type.
/// </summary>
public sealed record CommunityEventRows(
    IReadOnlyList<CommunityFeedRow> Feeds,
    IReadOnlyList<CommunitySleepRow> Sleeps,
    IReadOnlyList<CommunityTummyRow> TummyTimes,
    IReadOnlyList<CommunitySpellRow> Spells)
{
    private const string MethodMember = "method";
    private const string Bottle = "bottle";
    private const string BottleFeedingTypeMember = "bottle_feeding_type";
    private const string WhatHelpedMember = "what_helped";

    /// <summary>The only event types the loader asks the database for: the built-in feeding, sleep, tummy time and fussy types.</summary>
    public static readonly IReadOnlyList<Guid> ReadTypeIds = [BuiltInEventTypes.FeedingId, BuiltInEventTypes.SleepId, BuiltInEventTypes.TummyTimeId, BuiltInEventTypes.FussyId];

    public static CommunityEventRows Empty { get; } = new([], [], [], []);

    /// <summary>Keeps the facts of <paramref name="stored"/>; an event of another type is ignored.</summary>
    public static CommunityEventRows Read(IEnumerable<CommunityStoredEvent> stored)
    {
        ArgumentNullException.ThrowIfNull(stored);
        var events = stored.ToArray();
        return new CommunityEventRows(
            [.. events.Where(item => item.TypeId == BuiltInEventTypes.FeedingId).Select(FeedOf)],
            [.. events.Where(item => item.TypeId == BuiltInEventTypes.SleepId).Select(SleepOf).OfType<CommunitySleepRow>()],
            [.. events.Where(item => item.TypeId == BuiltInEventTypes.TummyTimeId).Select(TummyOf)],
            [.. events.Where(item => item.TypeId == BuiltInEventTypes.FussyId).Select(SpellOf).OfType<CommunitySpellRow>()]);
    }

    private static CommunityFeedRow FeedOf(CommunityStoredEvent stored)
    {
        using var document = JsonDocument.Parse(stored.Payload.Value);
        return new CommunityFeedRow(stored.StartedAt, stored.EndedAt is null ? null : FormulaDrunkMl(document.RootElement));
    }

    /// <summary>The drunk millilitres of a formula bottle; <c>null</c> for any other feed or a bottle without an amount.</summary>
    private static decimal? FormulaDrunkMl(JsonElement root)
    {
        var isFormulaBottle = Text(root, MethodMember) == Bottle && Text(root, BottleFeedingTypeMember) == BottleSampler.Formula;
        return isFormulaBottle && BottleAmounts.DrunkMl(root) is { } drunk ? (decimal)drunk : null;
    }

    private static CommunitySleepRow? SleepOf(CommunityStoredEvent stored)
    {
        var facts = EventPayloadFacts.Read(stored.Payload);
        var isSession = facts.Kind is null or SleepKinds.Nap or SleepKinds.Night;
        return isSession ? new CommunitySleepRow(stored.StartedAt, stored.EndedAt, facts.Kind == SleepKinds.Night, facts.PausedSeconds) : null;
    }

    private static CommunityTummyRow TummyOf(CommunityStoredEvent stored) =>
        new(stored.StartedAt, stored.EndedAt, EventPayloadFacts.Read(stored.Payload).PausedSeconds);

    /// <summary>A spell with a text answer that is not a false alarm (<c>cry_confirmed</c> false), as design 27 section 5 counts it.</summary>
    private static CommunitySpellRow? SpellOf(CommunityStoredEvent stored)
    {
        using var document = JsonDocument.Parse(stored.Payload.Value);
        var root = document.RootElement;
        var answer = Text(root, WhatHelpedMember);
        var falseAlarm = root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty(CryDetection.ConfirmedMember, out var confirmed)
            && confirmed.ValueKind == JsonValueKind.False;
        return string.IsNullOrWhiteSpace(answer) || falseAlarm ? null : new CommunitySpellRow(stored.StartedAt, CommunityCryCauses.FromWhatHelped(answer));
    }

    private static string? Text(JsonElement root, string key) =>
        root.ValueKind == JsonValueKind.Object && root.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
}
