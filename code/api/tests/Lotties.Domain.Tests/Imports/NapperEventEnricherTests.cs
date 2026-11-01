using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Imports;
using static Lotties.Domain.Tests.Imports.ImportTestData;

namespace Lotties.Domain.Tests.Imports;

public sealed class NapperEventEnricherTests
{
    private static readonly DateTimeOffset EnrichedAt = TestClock.Now.AddDays(30);

    private static NapperLogRow DetailedNap() => Row("NAP", Offset, Offset.AddHours(1)) with
    {
        HowBabySlept = "IN_BED",
        HowBabyWoke = "WOKE_UP_NATURALLY",
        BabyMoodOnWakeUp = "GOOD",
        TimeToFallAsleep = "10",
        NumberOfPauses = 2,
        PausedMinutes = 5m,
    };

    private static NapperEventCandidate Candidate(NapperLogRow row) => Assert.Single(NapperEventPlanner.Plan(Context(), [row], []).Candidates);

    private static Event Stored(NapperEventCandidate candidate, string payload, Guid? typeId = null, DateTimeOffset? end = null) => Event.Create(
        candidate.Event.Id,
        BabyId,
        typeId ?? candidate.Event.TypeId,
        UserId,
        candidate.Event.StartedAt,
        end ?? candidate.Event.EndedAt,
        EventPayload.From(payload),
        "Parent's note",
        TestClock.Now);

    private static IReadOnlyList<EventEnrichment> Plan(NapperEventCandidate candidate, Event stored) =>
        NapperEventEnricher.Plan([candidate], [stored], EnrichedAt);

    [Fact]
    public void Plan_StoredEventWithoutDetails_FillsEveryDetailAndPauseField()
    {
        var candidate = Candidate(DetailedNap());
        var stored = Stored(candidate, """{"kind":"nap","mood":"HAPPY"}""");

        var enrichment = Assert.Single(Plan(candidate, stored));

        Assert.Equal(["how_slept", "time_to_fall_asleep_minutes", "how_woke", "mood_on_wake", "pause_count", "paused_seconds"], enrichment.Enriched.FilledFields);
        Assert.True(EventPayload.From("""{"kind":"nap","mood":"HAPPY","how_slept":"in_bed","time_to_fall_asleep_minutes":10,"how_woke":"naturally","mood_on_wake":"good","pause_count":2,"paused_seconds":300}""").IsEquivalentTo(enrichment.Enriched.Payload));
        Assert.Equal((stored.Id, stored.Payload, EnrichedAt), (enrichment.EventId, enrichment.ExpectedPayload, enrichment.EnrichedAt));
    }

    [Fact]
    public void Plan_FieldsTheParentAlreadySet_AreNeverOverwritten()
    {
        var candidate = Candidate(DetailedNap());
        var stored = Stored(candidate, """{"kind":"nap","how_slept":"held","pause_count":1,"mood_on_wake":null}""");

        var enrichment = Assert.Single(Plan(candidate, stored));

        Assert.Equal(["time_to_fall_asleep_minutes", "how_woke", "mood_on_wake", "paused_seconds"], enrichment.Enriched.FilledFields);
        Assert.Equal(("held", "1", "good"), (Text(enrichment.Enriched.Payload, "how_slept"), Text(enrichment.Enriched.Payload, "pause_count"), Text(enrichment.Enriched.Payload, "mood_on_wake")));
    }

    [Fact]
    public void Plan_EverythingAlreadyPresent_PlansNothing()
    {
        var candidate = Candidate(DetailedNap());
        var first = Assert.Single(Plan(candidate, Stored(candidate, """{"kind":"nap"}""")));

        var second = Plan(candidate, Stored(candidate, first.Enriched.Payload.Value));

        Assert.Empty(second);
    }

    [Fact]
    public void Plan_SoftDeletedEvent_IsLeftAlone()
    {
        var candidate = Candidate(DetailedNap());
        var stored = Stored(candidate, """{"kind":"nap"}""");
        stored.SoftDelete(TestClock.Now);

        Assert.Empty(Plan(candidate, stored));
    }

    [Fact]
    public void Plan_EventWhoseTypeWasChanged_IsLeftAlone()
    {
        var candidate = Candidate(DetailedNap());

        Assert.Empty(Plan(candidate, Stored(candidate, """{"temperature_c":36}""", BuiltInEventTypes.BathId)));
    }

    [Fact]
    public void Plan_KindChangedToNightWaking_FillsOnlyThePausesBecauseTheDetailsDoNotApply()
    {
        var candidate = Candidate(DetailedNap());

        var enrichment = Assert.Single(Plan(candidate, Stored(candidate, """{"kind":"night_waking"}""")));

        Assert.Equal(["pause_count", "paused_seconds"], enrichment.Enriched.FilledFields);
    }

    [Fact]
    public void Plan_EventShortenedBelowThePausedTime_SkipsPausedSeconds()
    {
        var candidate = Candidate(DetailedNap());
        var stored = Stored(candidate, """{"kind":"nap"}""", end: candidate.Event.StartedAt.AddMinutes(4));

        var enrichment = Assert.Single(Plan(candidate, stored));

        Assert.DoesNotContain("paused_seconds", enrichment.Enriched.FilledFields);
        Assert.Contains("pause_count", enrichment.Enriched.FilledFields);
    }

    [Fact]
    public void Plan_NursingRow_FillsPausesOfTheFeeding()
    {
        var candidate = Candidate(Row("NURSING", Offset, Offset.AddMinutes(30)) with { BreastLeftSeconds = 600, NumberOfPauses = 1, PausedMinutes = 2m });
        var stored = Stored(candidate, """{"method":"breast","side":"left","breast_left_seconds":600}""");

        var enrichment = Assert.Single(Plan(candidate, stored));

        Assert.Equal(["pause_count", "paused_seconds"], enrichment.Enriched.FilledFields);
    }

    [Fact]
    public void Plan_RowWithoutDetails_PlansNothing()
    {
        var candidate = Candidate(Row("NAP", Offset, Offset.AddHours(1)));

        Assert.Empty(Plan(candidate, Stored(candidate, """{"kind":"nap"}""")));
    }

    [Fact]
    public void Plan_UnknownId_PlansNothing()
    {
        var candidate = Candidate(DetailedNap());

        Assert.Empty(NapperEventEnricher.Plan([candidate], [], EnrichedAt));
    }

    [Fact]
    public void TryEnrichPayload_UnchangedEvent_ReplacesOnlyThePayloadAndStampsBothUpdateTimes()
    {
        var candidate = Candidate(DetailedNap());
        var stored = Stored(candidate, """{"kind":"nap"}""");
        var enrichment = Assert.Single(Plan(candidate, stored));
        var (start, end, notes) = (stored.StartedAt, stored.EndedAt, stored.Notes);

        var applied = stored.TryEnrichPayload(enrichment.ExpectedPayload, enrichment.Enriched.Payload, EnrichedAt);

        Assert.True(applied);
        Assert.Equal(enrichment.Enriched.Payload, stored.Payload);
        Assert.Equal((start, end, notes, (DateTimeOffset?)null), (stored.StartedAt, stored.EndedAt, stored.Notes, stored.DeletedAt));
        Assert.Equal((EnrichedAt, EnrichedAt), (stored.UpdatedAt, stored.ClientUpdatedAt));
    }

    [Fact]
    public void TryEnrichPayload_PayloadChangedSinceThePlan_ChangesNothing()
    {
        var candidate = Candidate(DetailedNap());
        var stored = Stored(candidate, """{"kind":"nap"}""");
        var enrichment = Assert.Single(Plan(candidate, stored));
        stored.Edit(stored.TypeId, stored.StartedAt, stored.EndedAt, EventPayload.From("""{"kind":"night"}"""), stored.Notes, TestClock.Now.AddDays(1));
        var updatedAt = stored.UpdatedAt;

        Assert.False(stored.TryEnrichPayload(enrichment.ExpectedPayload, enrichment.Enriched.Payload, EnrichedAt));
        Assert.Equal(("night", updatedAt), (stored.Payload.GetString("kind"), stored.UpdatedAt));
    }

    [Fact]
    public void TryEnrichPayload_DeletedEvent_ChangesNothing()
    {
        var candidate = Candidate(DetailedNap());
        var stored = Stored(candidate, """{"kind":"nap"}""");
        var enrichment = Assert.Single(Plan(candidate, stored));
        stored.SoftDelete(TestClock.Now);

        Assert.False(stored.TryEnrichPayload(enrichment.ExpectedPayload, enrichment.Enriched.Payload, EnrichedAt));
        Assert.Equal("""{"kind":"nap"}""", stored.Payload.Value);
    }
}
