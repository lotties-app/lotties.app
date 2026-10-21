using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Exceptions;

namespace BabyRoutine.Domain.Tests.Events;

public sealed class EventTests
{
    private static readonly Guid EventId = Guid.NewGuid();
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();
    private static readonly DateTimeOffset Start = TestClock.Now.AddHours(-1);

    [Fact]
    public void Create_WithoutEnd_IsRunning()
    {
        var created = CreateRunning();

        Assert.Equal(EventId, created.Id);
        Assert.True(created.IsRunning);
        Assert.Null(created.Duration);
        Assert.Equal(TestClock.Now, created.UpdatedAt);
        Assert.Equal(TestClock.Now, created.CreatedAt);
    }

    [Fact]
    public void Create_WithEnd_IsNotRunningAndHasDuration()
    {
        var created = Event.Create(EventId, BabyId, BuiltInEventTypes.SleepId, UserId, Start, Start.AddMinutes(30), EventPayload.Empty, null, TestClock.Now);

        Assert.False(created.IsRunning);
        Assert.Equal(TimeSpan.FromMinutes(30), created.Duration);
    }

    [Fact]
    public void Create_EndEqualsStart_IsAllowed()
    {
        var created = Event.Create(EventId, BabyId, BuiltInEventTypes.DiaperId, UserId, Start, Start, EventPayload.Empty, null, TestClock.Now);

        Assert.Equal(TimeSpan.Zero, created.Duration);
    }

    [Fact]
    public void Create_EndBeforeStart_ThrowsInvalidTimeRange()
    {
        Assert.Throws<InvalidEventTimeRangeException>(
            () => Event.Create(EventId, BabyId, BuiltInEventTypes.SleepId, UserId, Start, Start.AddTicks(-10), EventPayload.Empty, null, TestClock.Now));
    }

    [Fact]
    public void Create_EmptyId_ThrowsArgument()
    {
        Assert.Throws<ArgumentException>(
            () => Event.Create(Guid.Empty, BabyId, BuiltInEventTypes.SleepId, UserId, Start, null, EventPayload.Empty, null, TestClock.Now));
    }

    [Fact]
    public void Create_NonUtcTimes_NormalizesToUtcMicroseconds()
    {
        var localStart = new DateTimeOffset(2026, 1, 10, 8, 0, 0, TimeSpan.FromHours(-3)).AddTicks(1234567);

        var created = Event.Create(EventId, BabyId, BuiltInEventTypes.SleepId, UserId, localStart, null, EventPayload.Empty, null, TestClock.Now);

        Assert.Equal(TimeSpan.Zero, created.StartedAt.Offset);
        Assert.Equal(new DateTimeOffset(2026, 1, 10, 11, 0, 0, TimeSpan.Zero).AddTicks(1234560), created.StartedAt);
    }

    [Fact]
    public void Create_NotesTrimmedAndBlankBecomesNull()
    {
        var withNotes = Event.Create(EventId, BabyId, BuiltInEventTypes.SleepId, UserId, Start, null, EventPayload.Empty, "  fussy  ", TestClock.Now);
        var blank = Event.Create(EventId, BabyId, BuiltInEventTypes.SleepId, UserId, Start, null, EventPayload.Empty, "  ", TestClock.Now);

        Assert.Equal(("fussy", (string?)null), (withNotes.Notes, blank.Notes));
    }

    [Fact]
    public void Create_NotesTooLong_ThrowsValidation()
    {
        var notes = new string('n', Event.NotesMaxLength + 1);

        Assert.Throws<DomainValidationException>(
            () => Event.Create(EventId, BabyId, BuiltInEventTypes.SleepId, UserId, Start, null, EventPayload.Empty, notes, TestClock.Now));
    }

    [Fact]
    public void Stop_Running_SetsEndAndBumpsUpdatedAt()
    {
        var running = CreateRunning();
        var later = TestClock.Now.AddMinutes(5);

        running.Stop(TestClock.Now, later);

        Assert.Equal(TestClock.Now, running.EndedAt);
        Assert.Equal(later, running.UpdatedAt);
        Assert.False(running.IsRunning);
    }

    [Fact]
    public void Stop_AlreadyStopped_ThrowsAlreadyStopped()
    {
        var running = CreateRunning();
        running.Stop(TestClock.Now, TestClock.Now);

        Assert.Throws<EventAlreadyStoppedException>(() => running.Stop(TestClock.Now, TestClock.Now));
    }

    [Fact]
    public void Stop_EndBeforeStart_ThrowsAndStaysRunning()
    {
        var running = CreateRunning();

        Assert.Throws<InvalidEventTimeRangeException>(() => running.Stop(Start.AddMinutes(-1), TestClock.Now));
        Assert.True(running.IsRunning);
    }

    [Fact]
    public void Stop_Deleted_ThrowsDeleted()
    {
        var running = CreateRunning();
        running.SoftDelete(TestClock.Now);

        Assert.Throws<EventDeletedException>(() => running.Stop(TestClock.Now, TestClock.Now));
    }

    [Fact]
    public void Edit_Valid_ReplacesDetailsAndBumpsUpdatedAt()
    {
        var running = CreateRunning();
        var payload = EventPayload.From("""{"intensity":3}""");
        var later = TestClock.Now.AddMinutes(10);

        running.Edit(BuiltInEventTypes.BellyPainId, Start, Start, payload, "after feed", later);

        Assert.Equal((BuiltInEventTypes.BellyPainId, (DateTimeOffset?)Start, payload, "after feed", later),
            (running.TypeId, running.EndedAt, running.Payload, running.Notes, running.UpdatedAt));
        Assert.Equal(UserId, running.CreatedBy);
    }

    [Fact]
    public void Edit_InvalidRange_ThrowsAndKeepsState()
    {
        var running = CreateRunning();

        Assert.Throws<InvalidEventTimeRangeException>(
            () => running.Edit(BuiltInEventTypes.BathId, Start, Start.AddMinutes(-1), EventPayload.Empty, null, TestClock.Now.AddMinutes(1)));
        Assert.Equal((BuiltInEventTypes.SleepId, (DateTimeOffset?)null, TestClock.Now), (running.TypeId, running.EndedAt, running.UpdatedAt));
    }

    [Fact]
    public void Edit_Deleted_ThrowsDeleted()
    {
        var running = CreateRunning();
        running.SoftDelete(TestClock.Now);

        Assert.Throws<EventDeletedException>(
            () => running.Edit(BuiltInEventTypes.SleepId, Start, null, EventPayload.Empty, null, TestClock.Now));
    }

    [Fact]
    public void SoftDelete_Active_SetsDeletedAtAndUpdatedAt()
    {
        var running = CreateRunning();
        var later = TestClock.Now.AddMinutes(3);

        running.SoftDelete(later);

        Assert.Equal((later, later), (running.DeletedAt, running.UpdatedAt));
        Assert.True(running.IsDeleted);
        Assert.False(running.IsRunning);
    }

    [Fact]
    public void SoftDelete_Twice_IsIdempotent()
    {
        var running = CreateRunning();
        var first = TestClock.Now.AddMinutes(3);
        running.SoftDelete(first);

        running.SoftDelete(first.AddMinutes(5));

        Assert.Equal((first, first), (running.DeletedAt, running.UpdatedAt));
    }

    [Fact]
    public void Edit_SameDetails_KeepsUpdatedAt()
    {
        var created = Event.Create(EventId, BabyId, BuiltInEventTypes.FeedingId, UserId, Start, null, EventPayload.From("""{"method":"bottle","amount":120}"""), "ok", TestClock.Now);

        created.Edit(BuiltInEventTypes.FeedingId, Start, null, EventPayload.From("""{ "amount": 120.0, "method": "bottle" }"""), " ok ", TestClock.Now.AddMinutes(5));

        Assert.Equal(TestClock.Now, created.UpdatedAt);
    }

    [Fact]
    public void Edit_PayloadValueChanged_BumpsUpdatedAt()
    {
        var created = Event.Create(EventId, BabyId, BuiltInEventTypes.FeedingId, UserId, Start, null, EventPayload.From("""{"amount":120}"""), null, TestClock.Now);
        var later = TestClock.Now.AddMinutes(5);

        created.Edit(BuiltInEventTypes.FeedingId, Start, null, EventPayload.From("""{"amount":130}"""), null, later);

        Assert.Equal((later, """{"amount":130}"""), (created.UpdatedAt, created.Payload.Value));
    }

    [Fact]
    public void DecideUpsert_ActiveWithoutClientTime_Applies()
    {
        Assert.Equal(EventUpsertDecision.Apply, CreateRunning().DecideUpsert(BabyId, null, TestClock.Now));
    }

    [Fact]
    public void DecideUpsert_ClientTimeEqualOrNewer_Applies()
    {
        var running = CreateRunning();

        Assert.Equal(
            (EventUpsertDecision.Apply, EventUpsertDecision.Apply),
            (running.DecideUpsert(BabyId, TestClock.Now, TestClock.Now), running.DecideUpsert(BabyId, TestClock.Now.AddSeconds(1), TestClock.Now)));
    }

    [Fact]
    public void DecideUpsert_ClientTimeOlderThanStored_IgnoresStale()
    {
        Assert.Equal(EventUpsertDecision.IgnoreStale, CreateRunning().DecideUpsert(BabyId, TestClock.Now.AddTicks(-10), TestClock.Now));
    }

    [Fact]
    public void DecideUpsert_ClientTimeInOtherOffset_ComparesAsUtc()
    {
        var sameInstant = TestClock.Now.ToOffset(TimeSpan.FromHours(-3));

        Assert.Equal(EventUpsertDecision.Apply, CreateRunning().DecideUpsert(BabyId, sameInstant, TestClock.Now));
    }

    [Fact]
    public void DecideUpsert_Deleted_IgnoresDeletedEvenWhenClientIsNewer()
    {
        var running = CreateRunning();
        running.SoftDelete(TestClock.Now);

        Assert.Equal(EventUpsertDecision.IgnoreDeleted, running.DecideUpsert(BabyId, TestClock.Now.AddDays(1), TestClock.Now));
    }

    [Fact]
    public void DecideUpsert_OtherBaby_ThrowsBabyMismatch()
    {
        var running = CreateRunning();
        running.SoftDelete(TestClock.Now);

        Assert.Throws<EventBabyMismatchException>(() => running.DecideUpsert(Guid.NewGuid(), null, TestClock.Now));
    }

    private static Event CreateRunning() =>
        Event.Create(EventId, BabyId, BuiltInEventTypes.SleepId, UserId, Start, null, EventPayload.Empty, null, TestClock.Now);
}
