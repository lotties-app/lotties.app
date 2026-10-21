using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;

namespace BabyRoutine.Domain.Tests.Events;

/// <summary>Last write wins between clients: client edit times are compared with the stored client edit time, never with the server receive time.</summary>
public sealed class EventClientUpdatedAtTests
{
    private static readonly Guid BabyId = Guid.NewGuid();
    private static readonly DateTimeOffset ServerNoon = TestClock.Now;
    private static readonly DateTimeOffset Start = ServerNoon.AddHours(-3);

    [Fact]
    public void Create_WithClientTime_StoresItAndStampsServerUpdatedAt()
    {
        var clientTime = ServerNoon.AddHours(-2);

        var created = CreateRunning(ServerNoon, clientTime);

        Assert.Equal((ServerNoon, clientTime), (created.UpdatedAt, created.ClientUpdatedAt));
    }

    [Fact]
    public void Create_WithoutClientTime_UsesServerTime()
    {
        Assert.Equal(ServerNoon, CreateRunning(ServerNoon, null).ClientUpdatedAt);
    }

    [Fact]
    public void Create_ClientTimeTooFarAhead_IsClampedToServerTime()
    {
        var created = CreateRunning(ServerNoon, ServerNoon + Event.MaxClientClockSkew + TimeSpan.FromTicks(10));

        Assert.Equal(ServerNoon, created.ClientUpdatedAt);
    }

    [Fact]
    public void Create_ClientTimeWithinSkew_IsKept()
    {
        var aheadWithinSkew = ServerNoon + Event.MaxClientClockSkew;

        Assert.Equal(aheadWithinSkew, CreateRunning(ServerNoon, aheadWithinSkew).ClientUpdatedAt);
    }

    [Fact]
    public void Create_ClientTimeInOtherOffsetWithSubMicroseconds_IsNormalizedToUtcMicroseconds()
    {
        var local = new DateTimeOffset(2026, 1, 10, 7, 0, 0, TimeSpan.FromHours(-3)).AddTicks(1234567);

        var created = CreateRunning(ServerNoon, local);

        Assert.Equal((TimeSpan.Zero, new DateTimeOffset(2026, 1, 10, 10, 0, 0, TimeSpan.Zero).AddTicks(1234560)), (created.ClientUpdatedAt.Offset, created.ClientUpdatedAt));
    }

    [Fact]
    public void StopAfterLateCreate_ClientTimeNewerThanStoredClientTime_IsApplied()
    {
        var created = CreateRunning(ServerNoon, ServerNoon.AddHours(-2));
        var stopClientTime = ServerNoon.AddHours(-2).AddMinutes(15);
        var receivedAt = ServerNoon.AddSeconds(1);

        var decision = created.DecideUpsert(BabyId, stopClientTime, receivedAt);
        created.Edit(BuiltInEventTypes.SleepId, Start, stopClientTime, EventPayload.Empty, null, receivedAt, stopClientTime);

        Assert.Equal(EventUpsertDecision.Apply, decision);
        Assert.Equal(((DateTimeOffset?)stopClientTime, receivedAt, stopClientTime), (created.EndedAt, created.UpdatedAt, created.ClientUpdatedAt));
    }

    [Fact]
    public void DecideUpsert_OlderClientEditAfterNewerOne_IgnoresStale()
    {
        var created = CreateRunning(ServerNoon, ServerNoon.AddMinutes(-30));
        created.Edit(BuiltInEventTypes.SleepId, Start, null, EventPayload.Empty, "newer", ServerNoon.AddMinutes(1), ServerNoon.AddMinutes(-10));

        var decision = created.DecideUpsert(BabyId, ServerNoon.AddMinutes(-20), ServerNoon.AddMinutes(2));

        Assert.Equal(EventUpsertDecision.IgnoreStale, decision);
    }

    [Fact]
    public void DecideUpsert_ClientTimeEqualToStored_Applies()
    {
        var clientTime = ServerNoon.AddMinutes(-30);

        Assert.Equal(EventUpsertDecision.Apply, CreateRunning(ServerNoon, clientTime).DecideUpsert(BabyId, clientTime, ServerNoon.AddMinutes(1)));
    }

    [Fact]
    public void DecideUpsert_ClientBehindServerButNewerThanStoredClientTime_Applies()
    {
        var created = CreateRunning(ServerNoon, ServerNoon.AddHours(-5));

        Assert.Equal(EventUpsertDecision.Apply, created.DecideUpsert(BabyId, ServerNoon.AddHours(-4), ServerNoon.AddHours(1)));
    }

    [Fact]
    public void DecideUpsert_FutureSkewedClientCannotLockOutLaterEdits()
    {
        var created = CreateRunning(ServerNoon, ServerNoon.AddDays(1));
        var laterReceipt = ServerNoon.AddMinutes(1);

        Assert.Equal(EventUpsertDecision.Apply, created.DecideUpsert(BabyId, laterReceipt, laterReceipt));
    }

    [Fact]
    public void DecideUpsert_IncomingTooFarAhead_IsComparedAsServerTime()
    {
        var created = CreateRunning(ServerNoon, ServerNoon.AddMinutes(4));

        Assert.Equal(EventUpsertDecision.IgnoreStale, created.DecideUpsert(BabyId, ServerNoon.AddYears(1), ServerNoon.AddMinutes(1)));
    }

    [Fact]
    public void Edit_SameDetailsWithNewerClientTime_ChangesNothing()
    {
        var clientTime = ServerNoon.AddMinutes(-30);
        var created = CreateRunning(ServerNoon, clientTime);

        created.Edit(BuiltInEventTypes.SleepId, Start, null, EventPayload.Empty, null, ServerNoon.AddMinutes(5), ServerNoon.AddMinutes(4));

        Assert.Equal((ServerNoon, clientTime), (created.UpdatedAt, created.ClientUpdatedAt));
    }

    [Fact]
    public void Edit_ChangedWithoutClientTime_UsesServerTime()
    {
        var created = CreateRunning(ServerNoon, ServerNoon.AddMinutes(-30));
        var later = ServerNoon.AddMinutes(5);

        created.Edit(BuiltInEventTypes.SleepId, Start, null, EventPayload.Empty, "changed", later);

        Assert.Equal((later, later), (created.UpdatedAt, created.ClientUpdatedAt));
    }

    [Fact]
    public void SoftDelete_StampsClientUpdatedAtWithDeletionTime()
    {
        var created = CreateRunning(ServerNoon, ServerNoon.AddMinutes(4));
        var deletedAt = ServerNoon.AddMinutes(1);

        created.SoftDelete(deletedAt);

        Assert.Equal((deletedAt, deletedAt), (created.UpdatedAt, created.ClientUpdatedAt));
    }

    [Fact]
    public void Stop_StampsClientUpdatedAtWithServerTime()
    {
        var created = CreateRunning(ServerNoon, ServerNoon.AddMinutes(-30));
        var later = ServerNoon.AddMinutes(2);

        created.Stop(later, later);

        Assert.Equal((later, later), (created.UpdatedAt, created.ClientUpdatedAt));
    }

    private static Event CreateRunning(DateTimeOffset receivedAt, DateTimeOffset? clientTime) =>
        Event.Create(Guid.NewGuid(), BabyId, BuiltInEventTypes.SleepId, Guid.NewGuid(), Start, null, EventPayload.Empty, null, receivedAt, clientTime);
}
