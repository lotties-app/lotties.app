using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;

namespace Lotties.Domain.Tests.Events;

/// <summary>
/// A Caregiver may stop, pause or resume someone else's running event and fill what was empty, nothing else
/// (<see cref="Event.EnsureEditableBy"/>, <see cref="RunningEventControl"/>).
/// </summary>
public sealed class RunningEventControlTests
{
    private static readonly Guid Ana = Guid.NewGuid();
    private static readonly Guid Grandma = Guid.NewGuid();
    private static readonly DateTimeOffset Start = TestClock.Now.AddMinutes(-30);
    private const string Running = """{"method":"bottle","bottle_feeding_type":"formula","food":"","pause_count":1,"paused_seconds":60}""";

    public static TheoryData<string, string, DateTimeOffset?, string?> AllowedEdits() => new()
    {
        { "stop", Running, TestClock.Now, "night bottle" },
        { "stop a moment ahead of the server clock", Running, TestClock.Now.AddMinutes(4), "night bottle" },
        { "pause", """{"method":"bottle","bottle_feeding_type":"formula","pause_count":1,"paused_seconds":60,"paused_at":"2026-01-10T11:50:00Z"}""", null, "night bottle" },
        { "resume", """{"method":"bottle","bottle_feeding_type":"formula","food":"","pause_count":2,"paused_seconds":360}""", null, "night bottle" },
        { "amount asked at the stop", """{"method":"bottle","bottle_feeding_type":"formula","food":"","amount_ml":120,"pause_count":1,"paused_seconds":60}""", TestClock.Now, "night bottle" },
        { "an empty value filled", """{"method":"bottle","bottle_feeding_type":"formula","food":"rice","pause_count":1,"paused_seconds":60}""", null, " night bottle " },
    };

    public static TheoryData<string, string, DateTimeOffset?, string?> RefusedEdits() => new()
    {
        { "a value overwritten", """{"method":"bottle","bottle_feeding_type":"breast_milk","pause_count":1,"paused_seconds":60}""", TestClock.Now, "night bottle" },
        { "a value removed", """{"method":"bottle","pause_count":1,"paused_seconds":60}""", TestClock.Now, "night bottle" },
        { "the note changed", Running, TestClock.Now, "changed" },
        { "the note removed", Running, null, null },
        { "an end before the start", Running, Start.AddMinutes(-1), "night bottle" },
        { "an end far in the future", Running, TestClock.Now.AddHours(1), "night bottle" },
    };

    [Theory]
    [MemberData(nameof(AllowedEdits))]
    public void EnsureEditableBy_CaregiverControlsOthersRunningEvent_IsAllowed(string scenario, string payload, DateTimeOffset? endedAt, string? notes)
    {
        var running = RunningBottle();

        var thrown = Record.Exception(() => running.EnsureEditableBy(Grandma, BabyRole.Caregiver, Edit(payload, endedAt, notes), TestClock.Now));

        Assert.True(thrown is null, scenario);
    }

    [Theory]
    [MemberData(nameof(RefusedEdits))]
    public void EnsureEditableBy_CaregiverBeyondStopPauseResume_ThrowsNotOwned(string scenario, string payload, DateTimeOffset? endedAt, string? notes)
    {
        var running = RunningBottle();

        var thrown = Record.Exception(() => running.EnsureEditableBy(Grandma, BabyRole.Caregiver, Edit(payload, endedAt, notes), TestClock.Now));

        Assert.True(thrown is EventNotOwnedException, scenario);
    }

    [Fact]
    public void EnsureEditableBy_CaregiverMovesTheStart_ThrowsNotOwned()
    {
        var running = RunningBottle();
        var edit = Edit(Running, TestClock.Now, "night bottle") with { StartedAt = Start.AddMinutes(-5) };

        Assert.Throws<EventNotOwnedException>(() => running.EnsureEditableBy(Grandma, BabyRole.Caregiver, edit, TestClock.Now));
    }

    [Fact]
    public void EnsureEditableBy_CaregiverChangesTheType_ThrowsNotOwned()
    {
        var running = RunningBottle();
        var edit = Edit(Running, TestClock.Now, "night bottle") with { TypeId = BuiltInEventTypes.SleepId };

        Assert.Throws<EventNotOwnedException>(() => running.EnsureEditableBy(Grandma, BabyRole.Caregiver, edit, TestClock.Now));
    }

    [Fact]
    public void EnsureEditableBy_CaregiverStopsAnEventAlreadyStoppedAtAnotherTime_ThrowsNotOwned()
    {
        var stopped = RunningBottle();
        stopped.Stop(TestClock.Now.AddMinutes(-10), TestClock.Now);

        Assert.Throws<EventNotOwnedException>(
            () => stopped.EnsureEditableBy(Grandma, BabyRole.Caregiver, Edit(Running, TestClock.Now, "night bottle"), TestClock.Now));
    }

    [Fact]
    public void EnsureEditableBy_CaregiverReplaysTheStoredDetails_IsAllowedAsANoOp()
    {
        var stopped = RunningBottle();
        var end = TestClock.Now.AddMinutes(-10);
        stopped.Stop(end, TestClock.Now);

        var thrown = Record.Exception(
            () => stopped.EnsureEditableBy(Grandma, BabyRole.Caregiver, new EventEdit(stopped.TypeId, stopped.StartedAt, end, stopped.Payload, "night bottle"), TestClock.Now));

        Assert.Null(thrown);
    }

    [Fact]
    public void EnsureEditableBy_CaregiverOnADeletedRunningEvent_ThrowsNotOwned()
    {
        var deleted = RunningBottle();
        deleted.SoftDelete(TestClock.Now);

        Assert.Throws<EventNotOwnedException>(
            () => deleted.EnsureEditableBy(Grandma, BabyRole.Caregiver, Edit(Running, TestClock.Now, "night bottle"), TestClock.Now));
    }

    [Fact]
    public void EnsureEditableBy_ViewerStopping_ThrowsNotOwned()
    {
        var running = RunningBottle();

        Assert.Throws<EventNotOwnedException>(
            () => running.EnsureEditableBy(Grandma, BabyRole.Viewer, Edit(Running, TestClock.Now, "night bottle"), TestClock.Now));
    }

    [Theory]
    [InlineData(BabyRole.Owner)]
    [InlineData(BabyRole.Parent)]
    public void EnsureEditableBy_OwnerOrParent_AnyEdit_IsAllowed(BabyRole role)
    {
        var running = RunningBottle();
        var edit = Edit("""{"method":"breast"}""", TestClock.Now, "moved") with { StartedAt = Start.AddMinutes(-5) };

        var thrown = Record.Exception(() => running.EnsureEditableBy(Grandma, role, edit, TestClock.Now));

        Assert.Null(thrown);
    }

    [Fact]
    public void EnsureChangeableBy_CaregiverDeletingOthersRunningEvent_ThrowsNotOwned()
    {
        var running = RunningBottle();

        Assert.Throws<EventNotOwnedException>(() => running.EnsureChangeableBy(Grandma, BabyRole.Caregiver));
    }

    private static Event RunningBottle() =>
        Event.Create(Guid.NewGuid(), Guid.NewGuid(), BuiltInEventTypes.FeedingId, Ana, Start, null, EventPayload.From(Running), "night bottle", TestClock.Now);

    private static EventEdit Edit(string payload, DateTimeOffset? endedAt, string? notes) =>
        new(BuiltInEventTypes.FeedingId, Start, endedAt, EventPayload.From(payload), notes);
}
