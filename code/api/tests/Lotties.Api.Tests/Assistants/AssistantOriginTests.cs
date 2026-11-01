using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.EventTypes;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The origin marker (docs/design/32-assistants.md "Origin marker"): every event an assistant command creates carries
/// <c>via</c> (the adapter name); stopping a timer the app or another adapter started adds <c>updated_via</c> and keeps the
/// original <c>via</c>; an adapter stopping its own timer leaves only <c>via</c>; a replayed request changes nothing.
/// </summary>
public sealed class AssistantOriginTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static AssistantInvocation From(string adapter, string? requestId = null) => new(adapter, requestId ?? $"req-{Guid.NewGuid():N}");

    private static (string? Via, string? UpdatedVia) Marks(Lotties.Domain.Events.Event stored) =>
        (AssistantOrigin.ViaOf(stored.Payload), AssistantOrigin.UpdatedViaOf(stored.Payload));

    [Fact]
    public async Task EveryCreatingCommand_MarksTheEventWithTheAdapter()
    {
        var baby = await factory.SeedBabyAsync();

        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogBottleAsync(From("alexa"), 120, BottleKind.Formula));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogDiaperAsync(From("alexa"), DiaperKind.Wet));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogNursingAsync(From("alexa"), BreastSide.Left));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepStartAsync(From("alexa")));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepEndAsync(From("alexa")));

        var events = await factory.EventsAsync(baby.BabyId);
        Assert.Equal(5, events.Count);
        Assert.All(events, stored => Assert.Equal(("alexa", null), Marks(stored)));
    }

    [Fact]
    public async Task StoppingAnAppStartedSleep_AddsUpdatedViaAndNoVia()
    {
        var baby = await factory.SeedBabyAsync();
        var id = await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, DateTimeOffset.UtcNow.AddMinutes(-40), null, """{"kind":"nap"}""");

        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepEndAsync(From("alexa")));

        var stopped = await factory.EventAsync(id);
        Assert.False(stopped.IsRunning);
        Assert.Equal((null, "alexa"), Marks(stopped));
        Assert.Equal("nap", PayloadOf(stopped).GetProperty("kind").GetString());
    }

    [Fact]
    public async Task StoppingYourOwnSleep_KeepsOnlyVia_AndAnotherAdapterAddsUpdatedVia()
    {
        var baby = await factory.SeedBabyAsync();
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepStartAsync(From("alexa")));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepEndAsync(From("alexa")));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepStartAsync(From("mcp")));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogSleepEndAsync(From("alexa")));

        var sleeps = (await factory.EventsAsync(baby.BabyId)).Where(stored => PayloadOf(stored).TryGetProperty("kind", out var kind) && kind.GetString() is "nap" or "night").OrderBy(stored => stored.StartedAt).ToArray();

        Assert.Equal(2, sleeps.Length);
        Assert.Equal(("alexa", null), Marks(sleeps[0]));
        Assert.Equal(("mcp", "alexa"), Marks(sleeps[1]));
    }

    [Fact]
    public async Task ReplayingARequest_ChangesNothingAndKeepsTheMarker()
    {
        var baby = await factory.SeedBabyAsync();
        var invocation = From("alexa", "same-request");

        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogDiaperAsync(invocation, DiaperKind.Dirty));
        var first = Assert.Single(await factory.EventsAsync(baby.BabyId));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogDiaperAsync(From("mcp", "same-request"), DiaperKind.Dirty));
        await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.LogDiaperAsync(invocation, DiaperKind.Dirty));

        var events = await factory.EventsAsync(baby.BabyId);
        Assert.Equal(2, events.Count);
        Assert.Equal(("alexa", null), Marks(events.Single(stored => stored.Id == first.Id)));
        Assert.Equal(first.Payload.Value, events.Single(stored => stored.Id == first.Id).Payload.Value);
    }

    [Theory]
    [InlineData("alexa", "alexa", "alexa", null)]
    [InlineData(null, "alexa", null, "alexa")]
    [InlineData("mcp", "alexa", "mcp", "alexa")]
    public void Changed_KeepsTheOriginalViaAndAddsUpdatedViaOnlyForAnotherOrigin(string? via, string adapter, string? expectedVia, string? expectedUpdated)
    {
        var payload = via is null ? Lotties.Domain.Events.EventPayload.From("""{"kind":"nap"}""") : Lotties.Domain.Events.EventPayload.From($$"""{"kind":"nap","via":"{{via}}"}""");

        var changed = AssistantOrigin.Changed(payload, adapter);

        Assert.Equal((expectedVia, expectedUpdated), (AssistantOrigin.ViaOf(changed), AssistantOrigin.UpdatedViaOf(changed)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("Not A Word")]
    [InlineData("has;semicolon")]
    public void Created_AnAdapterThatIsNotAPlainWord_LeavesThePayloadAlone(string adapter)
    {
        var payload = Lotties.Domain.Events.EventPayload.From("""{"content":"WET"}""");

        Assert.Equal(payload.Value, AssistantOrigin.Created(payload, adapter).Value);
    }
}
