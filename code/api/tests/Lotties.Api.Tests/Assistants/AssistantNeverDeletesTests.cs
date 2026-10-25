using System.Text.RegularExpressions;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Tests.Support;
using Lotties.Application.Assistants;
using Lotties.Domain.Assistants;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Microsoft.AspNetCore.Mvc.Testing;
using static Lotties.Api.Tests.Assistants.AssistantTestKit;
using static Lotties.Api.Tests.Support.ClinicalTestData;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// "Assistants never delete" (docs/design/32-assistants.md): no assistant path reaches a delete, an assistant may only ask
/// (<c>delete_requested_via</c>, <c>delete_requested_at</c>) for an entry its own adapter made in the last 30 minutes, and the
/// person approves in the app. Structure tests fail if a delete is ever wired into the assistant code; behaviour tests prove
/// no command lowers an event count or touches another origin's entry.
/// </summary>
public sealed class AssistantNeverDeletesTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly Regex DeleteCall = new(@"\.(Delete(?!Requested)|SoftDelete|Erase|Purge|Truncate)\w*\s*\(|\.RemoveRange\(|\b(repository|context|events|clinicalEvents|eventService|appointments|formulas)\.Remove\w*\(|\bDeletedAt\b|\bMarkDeleted\b|\bIsDeleted\s*=[^=]", RegexOptions.Compiled);

    private readonly WebApplicationFactory<Program> _host = factory.WithFixedClock();

    private static string SourceRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "src", "Lotties.Application", "Assistants")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName ?? throw new InvalidOperationException("The API source folder was not found.");
    }

    [Fact]
    public void AssistantSource_NeverCallsADeleteOrRemove()
    {
        var root = SourceRoot();
        var files = Directory.GetFiles(Path.Combine(root, "src", "Lotties.Application", "Assistants"), "*.cs")
            .Concat(Directory.GetFiles(Path.Combine(root, "src", "Lotties.Api", "Assistants"), "*.cs", SearchOption.AllDirectories))
            .Concat(Directory.GetFiles(Path.Combine(root, "src", "Lotties.Domain", "Assistants"), "*.cs"))
            .ToArray();

        var offenders = files
            .SelectMany(file => File.ReadAllLines(file).Select((line, index) => (File: Path.GetFileName(file), Line: index + 1, Text: line.Trim())))
            .Where(entry => !entry.Text.StartsWith("//", StringComparison.Ordinal) && !entry.Text.StartsWith("///", StringComparison.Ordinal) && !entry.Text.StartsWith('*'))
            .Where(entry => DeleteCall.IsMatch(entry.Text))
            .Select(entry => $"{entry.File}:{entry.Line}: {entry.Text}")
            .ToArray();

        Assert.NotEmpty(files);
        Assert.Empty(offenders);
    }

    [Fact]
    public void AssistantServiceInterface_HasNoDeleteMethodExceptTheRequest()
    {
        var named = typeof(IAssistantService).GetMethods()
            .Select(method => method.Name)
            .Where(name => Regex.IsMatch(name, "Delete|Remove|Erase|Purge", RegexOptions.IgnoreCase))
            .ToArray();

        Assert.Equal(["RequestDeleteLastAsync"], named);
    }

    [Fact]
    public void McpToolList_HasNoDeleteToolExceptTheRequest()
    {
        var names = McpToolCatalog.All.Select(tool => tool.Name).Where(name => Regex.IsMatch(name, "delete|remove|erase|purge", RegexOptions.IgnoreCase)).ToArray();

        Assert.Equal(["request_delete_last_entry"], names);
        Assert.True(McpToolCatalog.Find("request_delete_last_entry")!.Writes);
    }

    private static Event Entry(Guid babyId, Guid userId, Guid typeId, string payload, int createdMinutesAgo = 0) =>
        Event.Create(Guid.NewGuid(), babyId, typeId, userId, TestUsers.Now.AddMinutes(-createdMinutesAgo), TestUsers.Now.AddMinutes(-createdMinutesAgo), EventPayload.From(payload), null, TestUsers.Now.AddMinutes(-createdMinutesAgo));

    private async Task<(SeededBaby Baby, Guid UserId)> SeededAsync(params Func<Guid, Guid, Event>[] entries)
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var user = await factory.UserIdAsync(baby.OwnerSubject);
        var events = entries.Select(make => make(baby.BabyId, user)).ToArray();
        await factory.SeedAsync(context =>
        {
            context.Events.AddRange(events);
            return Task.CompletedTask;
        });
        return (baby, user);
    }

    [Fact]
    public async Task RequestDeleteLast_MarksTheNewestEntryOfTheSameAdapter_AndDeletesNothing()
    {
        var (baby, _) = await SeededAsync(
            (id, user) => Entry(id, user, BuiltInEventTypes.DiaperId, """{"content":"WET","via":"alexa"}""", 20),
            (id, user) => Entry(id, user, BuiltInEventTypes.FeedingId, """{"method":"bottle","amount_ml":100,"via":"alexa"}""", 5));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")));

        var events = await factory.EventsAsync(baby.BabyId);
        Assert.Equal((AssistantResultCode.DeleteRequested, "feeding"), (result.Code, result.EntryType));
        Assert.All(events, stored => Assert.Null(stored.DeletedAt));
        var marked = events.Single(stored => AssistantOrigin.DeleteRequestedViaOf(stored.Payload) is not null);
        Assert.Equal(BuiltInEventTypes.FeedingId, marked.TypeId);
        var payload = PayloadOf(marked);
        Assert.Equal(("alexa", "bottle", 100, "2026-01-10T12:00:00.000Z"), (payload.GetProperty("via").GetString(), payload.GetProperty("method").GetString(), payload.GetProperty("amount_ml").GetInt32(), payload.GetProperty("delete_requested_at").GetString()));
    }

    [Fact]
    public async Task RequestDeleteLast_NewestIsTheWakeUp_StopsWithoutMarkingAnOlderBottle()
    {
        var (baby, _) = await SeededAsync(
            (id, user) => Entry(id, user, BuiltInEventTypes.FeedingId, """{"method":"bottle","amount_ml":100,"via":"alexa"}""", 5),
            (id, user) => Entry(id, user, BuiltInEventTypes.SleepId, """{"kind":"woke_up","via":"alexa"}""", 2));
        var before = (await factory.EventsAsync(baby.BabyId)).ToDictionary(stored => stored.Id, stored => stored.Payload.Value);

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")));

        Assert.Equal((AssistantResultCode.LastNotUndoable, "woke_up"), (result.Code, result.EntryType));
        Assert.Equal(before, (await factory.EventsAsync(baby.BabyId)).ToDictionary(stored => stored.Id, stored => stored.Payload.Value));
    }

    [Fact]
    public async Task RequestDeleteLast_NewestIsABottleAfterAnOlderWakeUp_MarksTheBottle()
    {
        var (baby, _) = await SeededAsync(
            (id, user) => Entry(id, user, BuiltInEventTypes.SleepId, """{"kind":"woke_up","via":"alexa"}""", 8),
            (id, user) => Entry(id, user, BuiltInEventTypes.FeedingId, """{"method":"bottle","amount_ml":100,"via":"alexa"}""", 2));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")));

        Assert.Equal(AssistantResultCode.DeleteRequested, result.Code);
        Assert.Equal(BuiltInEventTypes.FeedingId, Assert.Single((await factory.EventsAsync(baby.BabyId)).Where(stored => AssistantOrigin.DeleteRequestedViaOf(stored.Payload) is not null)).TypeId);
    }

    [Fact]
    public async Task RequestDeleteLast_NewestEntryOfTheAppOrAnotherAdapter_IsStillIgnored()
    {
        var (baby, _) = await SeededAsync(
            (id, user) => Entry(id, user, BuiltInEventTypes.FeedingId, """{"method":"bottle","amount_ml":100,"via":"alexa"}""", 6),
            (id, user) => Entry(id, user, BuiltInEventTypes.SleepId, """{"kind":"woke_up","via":"mcp"}""", 1),
            (id, user) => Entry(id, user, BuiltInEventTypes.DiaperId, """{"content":"WET"}""", 1));

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")));

        Assert.Equal(AssistantResultCode.DeleteRequested, result.Code);
    }

    [Fact]
    public async Task RequestDeleteLast_Twice_ChangesNothingTheSecondTime()
    {
        var (baby, _) = await SeededAsync((id, user) => Entry(id, user, BuiltInEventTypes.DiaperId, """{"content":"DIRTY","via":"alexa"}""", 2));

        await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation("req-1", adapter: "alexa")));
        var first = Assert.Single(await factory.EventsAsync(baby.BabyId));
        var again = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation("req-2", adapter: "alexa")));
        var replay = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation("req-1", adapter: "alexa")));

        var second = Assert.Single(await factory.EventsAsync(baby.BabyId));
        Assert.Equal((AssistantResultCode.DeleteRequested, AssistantResultCode.DeleteRequested), (again.Code, replay.Code));
        Assert.Equal((first.Payload.Value, first.UpdatedAt), (second.Payload.Value, second.UpdatedAt));
    }

    [Fact]
    public async Task RequestDeleteLast_NeverTouchesAnotherOriginOrAnOldEntry()
    {
        var (baby, _) = await SeededAsync(
            (id, user) => Entry(id, user, BuiltInEventTypes.DiaperId, """{"content":"WET"}""", 1),
            (id, user) => Entry(id, user, BuiltInEventTypes.FeedingId, """{"method":"bottle","amount_ml":90,"via":"mcp"}""", 1),
            (id, user) => Entry(id, user, BuiltInEventTypes.FeedingId, """{"method":"bottle","amount_ml":80,"via":"alexa"}""", 45));
        var before = (await factory.EventsAsync(baby.BabyId)).ToDictionary(stored => stored.Id, stored => stored.Payload.Value);

        var result = await _host.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")));

        Assert.Equal(AssistantResultCode.NoEntryToDelete, result.Code);
        Assert.Equal(before, (await factory.EventsAsync(baby.BabyId)).ToDictionary(stored => stored.Id, stored => stored.Payload.Value));
    }

    [Fact]
    public async Task RequestDeleteLast_AViewer_IsNotAllowed()
    {
        var (baby, _) = await SeededAsync((id, user) => Entry(id, user, BuiltInEventTypes.DiaperId, """{"content":"WET","via":"alexa"}""", 1));

        var result = await _host.RunAsAsync(baby.SubjectOf(BabyRole.Viewer), assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")));

        Assert.Equal(AssistantResultCode.NotAllowed, result.Code);
        Assert.Null(AssistantOrigin.DeleteRequestedViaOf(Assert.Single(await factory.EventsAsync(baby.BabyId)).Payload));
    }

    [Fact]
    public async Task EveryAssistantCommand_NeverLowersTheEventCountOrSoftDeletes()
    {
        var baby = await factory.SeedBabyAsync();
        var invocation = Invocation(adapter: "alexa");
        Func<IAssistantService, Task<AssistantResult>>[] commands =
        [
            assistant => assistant.LogSleepStartAsync(Invocation(adapter: "alexa")),
            assistant => assistant.LogBottleAsync(Invocation(adapter: "alexa"), 120, BottleKind.Formula),
            assistant => assistant.LogNursingAsync(Invocation(adapter: "alexa"), BreastSide.Left),
            assistant => assistant.LogDiaperAsync(Invocation(adapter: "alexa"), DiaperKind.Wet),
            assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")),
            assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")),
            assistant => assistant.LogSleepEndAsync(Invocation(adapter: "alexa")),
            assistant => assistant.ReadLastFeedAsync(invocation),
            assistant => assistant.ReadCryReasonsAsync(invocation),
            assistant => assistant.ReadNextFeedAsync(invocation),
            assistant => assistant.ReadDaySummaryAsync(invocation, null),
        ];
        var previous = 0;

        foreach (var command in commands)
        {
            await factory.RunAsAsync(baby.OwnerSubject, command);
            var events = await factory.EventsAsync(baby.BabyId);
            Assert.True(events.Count >= previous);
            Assert.All(events, stored => Assert.Null(stored.DeletedAt));
            previous = events.Count;
        }
    }

    [Fact]
    public async Task RequestDeleteLast_AnEntryThePersonMadeInTheApp_IsNeverMarked()
    {
        var baby = await factory.SeedBabyAsync();
        var appEntry = await factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.DiaperId, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, """{"content":"WET"}""");

        var result = await factory.RunAsAsync(baby.OwnerSubject, assistant => assistant.RequestDeleteLastAsync(Invocation(adapter: "alexa")));

        Assert.Equal(AssistantResultCode.NoEntryToDelete, result.Code);
        Assert.Null(AssistantOrigin.DeleteRequestedViaOf((await factory.EventAsync(appEntry)).Payload));
    }
}
