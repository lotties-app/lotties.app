using System.Text.Json;
using Lotties.Api.Assistants.Mcp;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Babies;
using Lotties.Domain.EventTypes;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Lotties.Api.Tests.Assistants;

/// <summary>
/// The MCP server through the official SDK client against the real endpoint (docs/design/32-assistants.md section 9):
/// both protocol eras (2026-07-28 per-request, 2025-11-25 initialize handshake), the tool list by scope, every tool, the
/// typed tool errors and idempotent replays.
/// </summary>
public sealed class McpProtocolTests(McpApiHost host) : IClassFixture<McpApiHost>
{
    private static readonly string[] ReadTools =
        ["list_babies", "get_baby_profile", "get_last_feed", "get_sleep_status", "get_diapers_today", "get_next_appointment", "get_due_vaccines", "get_day_summary", "get_week_summary",
            "get_next_nap_window", "get_next_feed", "get_next_diaper", "get_diapers_average", "get_bottle_average", "get_sleep_today", "get_bottle_today", "get_feeds_today", "get_last_diaper", "get_cry_reasons"];

    private static readonly string[] WriteTools = ["request_delete_last_entry", "log_sleep_start", "log_sleep_end", "log_bottle", "log_nursing", "log_diaper"];

    private ApiFactory Factory => host.Factory;

    [Theory]
    [InlineData(null)]
    [InlineData(McpApiHost.LegacyProtocol)]
    public async Task Connect_BothEras_NameTheServerAndListTheReadToolsOfAReadToken(string? protocol)
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject), protocol);

        var tools = await client.ListToolsAsync();

        Assert.Equal("lotties", client.ServerInfo?.Name);
        Assert.Equal(protocol ?? McpApiHost.ModernProtocol, client.NegotiatedProtocolVersion);
        Assert.Equal(ReadTools, tools.Select(tool => tool.Name));
    }

    [Fact]
    public async Task ListTools_ReadAndWriteToken_ListsEveryTool_WithHintsAndStrictSchemas()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var tools = (await client.ListToolsAsync()).Select(tool => tool.ProtocolTool).ToArray();

        Assert.Equal(ReadTools.Concat(WriteTools), tools.Select(tool => tool.Name));
        Assert.All(tools, tool =>
        {
            Assert.Contains("not medical advice", tool.Description, StringComparison.Ordinal);
            Assert.False(tool.InputSchema.GetProperty("additionalProperties").GetBoolean());
            Assert.Equal((false, false), (tool.Annotations!.DestructiveHint, tool.Annotations.OpenWorldHint));
        });
        Assert.All(tools.Where(tool => ReadTools.Contains(tool.Name)), tool => Assert.True(tool.Annotations!.ReadOnlyHint));
        Assert.All(tools.Where(tool => WriteTools.Contains(tool.Name)), tool =>
        {
            Assert.Equal((false, true), (tool.Annotations!.ReadOnlyHint, tool.Annotations.IdempotentHint));
            Assert.True(tool.InputSchema.GetProperty("properties").TryGetProperty("idempotencyKey", out _));
        });
        Assert.DoesNotContain(tools, tool => tool.Name.Contains("medic", StringComparison.OrdinalIgnoreCase) || tool.Name.Contains("dose", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task ListTools_WriteOnlyToken_ListsOnlyTheWriteTools()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpScopes.Write));

        var tools = await client.ListToolsAsync();

        Assert.Equal(WriteTools, tools.Select(tool => tool.Name));
    }

    [Theory]
    [InlineData(null)]
    [InlineData(McpApiHost.LegacyProtocol)]
    public async Task LogBottle_ThenReadIt_WritesAsTheTokenUserAndAnswersStructuredJson(string? protocol)
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Caregiver);
        var subject = baby.SubjectOf(BabyRole.Caregiver);
        await using var client = await host.ClientAsync(host.TokenFor(subject, McpApiHost.ReadWrite), protocol);

        var logged = await client.CallToolAsync("log_bottle", Args(("amountMl", 120), ("kind", "breast_milk")));
        var last = await client.CallToolAsync("get_last_feed", Args());

        var stored = Assert.Single(await Factory.EventsAsync(baby.BabyId));
        Assert.Equal((BuiltInEventTypes.FeedingId, await Factory.UserIdAsync(subject)), (stored.TypeId, stored.CreatedBy));
        Assert.NotEqual(true, logged.IsError);
        Assert.Equal(("bottle_logged", 120, "breast_milk", baby.BabyId), (Code(logged), Structured(logged).GetProperty("amountMl").GetInt32(), Structured(logged).GetProperty("bottleKind").GetString(), Structured(logged).GetProperty("baby").GetProperty("id").GetGuid()));
        Assert.Equal(("last_feed", "bottle"), (Code(last), Structured(last).GetProperty("feedMethod").GetString()));
        Assert.Contains("120 ml", Text(logged), StringComparison.Ordinal);
        Assert.Equal(JsonSerializer.Serialize(Structured(logged)), JsonSerializer.Serialize(JsonDocument.Parse(((TextContentBlock)logged.Content[1]).Text).RootElement));
    }

    [Fact]
    public async Task EveryReadTool_OwnerOfOneBaby_AnswersItsCode()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject));

        var codes = new List<string>();
        foreach (var tool in ReadTools)
        {
            var result = await client.CallToolAsync(tool, Args());
            Assert.NotEqual(true, result.IsError);
            codes.Add(Code(result));
        }

        Assert.Equal(["babies", "baby_profile", "no_feeds", "no_sleeps", "diapers_today", "no_appointment", Code(await client.CallToolAsync("get_due_vaccines", Args())), "day_summary", "week_summary",
                "no_nap_prediction", "no_next_feed", "no_next_diaper", "no_diapers_average", "no_bottle_data", "sleep_today", "bottle_today", "feeds_today", "no_diapers", "cry_no_data"], codes);
    }

    [Fact]
    public async Task EveryWriteTool_Owner_LogsAndAnswersItsCode()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var codes = new[]
        {
            Code(await client.CallToolAsync("log_sleep_start", Args())),
            Code(await client.CallToolAsync("log_sleep_end", Args())),
            Code(await client.CallToolAsync("log_nursing", Args(("side", "left")))),
            Code(await client.CallToolAsync("log_diaper", Args(("kind", "both")))),
            Code(await client.CallToolAsync("log_bottle", Args(("amountMl", 90)))),
            Code(await client.CallToolAsync("request_delete_last_entry", Args())),
        };

        Assert.Equal(["sleep_started", "sleep_ended", "nursing_started", "diaper_logged", "bottle_logged", "delete_requested"], codes);
        Assert.Equal(5, (await Factory.EventsAsync(baby.BabyId)).Count);
    }

    [Fact]
    public async Task EveryWriteTool_MarksTheStoredEventViaMcp_AndAReplayKeepsIt()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        await client.CallToolAsync("log_sleep_start", Args(("idempotencyKey", "origin-key-sleep")));
        await client.CallToolAsync("log_sleep_start", Args(("idempotencyKey", "origin-key-sleep")));
        await client.CallToolAsync("log_sleep_end", Args());
        await client.CallToolAsync("log_nursing", Args(("side", "left")));
        await client.CallToolAsync("log_diaper", Args(("kind", "wet")));
        await client.CallToolAsync("log_bottle", Args(("amountMl", 90)));

        var events = await Factory.EventsAsync(baby.BabyId);
        Assert.Equal(5, events.Count);
        Assert.All(events, stored =>
        {
            var payload = JsonDocument.Parse(stored.Payload.Value).RootElement;
            Assert.Equal("mcp", payload.GetProperty("via").GetString());
            Assert.False(payload.TryGetProperty("updated_via", out _));
        });
    }

    [Fact]
    public async Task Write_SameIdempotencyKeyTwice_LogsOnce_DifferentKeysOrNoKeyLogAgain()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var first = await client.CallToolAsync("log_diaper", Args(("kind", "wet"), ("idempotencyKey", "retry-key-0001")));
        var replay = await client.CallToolAsync("log_diaper", Args(("kind", "wet"), ("idempotencyKey", "retry-key-0001")));
        await client.CallToolAsync("log_diaper", Args(("kind", "wet"), ("idempotencyKey", "retry-key-0002")));
        await client.CallToolAsync("log_diaper", Args(("kind", "wet")));
        await client.CallToolAsync("log_diaper", Args(("kind", "wet")));

        Assert.Equal(4, (await Factory.EventsAsync(baby.BabyId)).Count);
        Assert.Equal(Structured(first).GetProperty("at").GetDateTimeOffset(), Structured(replay).GetProperty("at").GetDateTimeOffset());
    }

    [Fact]
    public async Task Write_SameKeyFromAnotherUser_IsNotAReplay()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Parent);
        await using var owner = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));
        await using var parent = await host.ClientAsync(host.TokenFor(baby.SubjectOf(BabyRole.Parent), McpApiHost.ReadWrite));

        await owner.CallToolAsync("log_diaper", Args(("kind", "wet"), ("idempotencyKey", "shared-key-0001")));
        await parent.CallToolAsync("log_diaper", Args(("kind", "wet"), ("idempotencyKey", "shared-key-0001")));

        Assert.Equal(2, (await Factory.EventsAsync(baby.BabyId)).Count);
    }

    [Theory]
    [InlineData("log_bottle", """{"amountMl":0}""", "amountMl")]
    [InlineData("log_bottle", """{"amountMl":501}""", "amountMl")]
    [InlineData("log_bottle", """{"amountMl":"120"}""", "amountMl")]
    [InlineData("log_bottle", """{"amountMl":120.5}""", "amountMl")]
    [InlineData("log_bottle", """{}""", "amountMl")]
    [InlineData("log_bottle", """{"amountMl":120,"kind":"juice"}""", "kind")]
    [InlineData("log_bottle", """{"amountMl":120,"dose":"5 ml"}""", "dose")]
    [InlineData("log_diaper", """{"kind":"WET"}""", "kind")]
    [InlineData("log_diaper", """{"kind":"wet","note":"rash"}""", "note")]
    [InlineData("log_diaper", """{"kind":"wet","babyId":"not-a-uuid"}""", "babyId")]
    [InlineData("log_diaper", """{"kind":"wet","idempotencyKey":"short"}""", "idempotencyKey")]
    [InlineData("log_diaper", """{"kind":"wet","idempotencyKey":"has spaces in it"}""", "idempotencyKey")]
    [InlineData("get_day_summary", """{"date":"23/10/2026"}""", "date")]
    [InlineData("list_babies", """{"babyId":"6f3c2b1e-9a54-5d7e-8c21-4b0e7d9a1f35"}""", "babyId")]
    [InlineData("get_day_summary", """{"timeZone":"Mars/Olympus_Mons"}""", "timeZone")]
    [InlineData("log_diaper", """{"kind":"wet","timeZone":42}""", "timeZone")]
    [InlineData("list_babies", """{"timeZone":"America/Sao_Paulo"}""", "timeZone")]
    public async Task Call_InvalidArguments_IsAToolErrorNamingTheFieldAndWritesNothing(string tool, string arguments, string field)
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var result = await client.CallToolAsync(new CallToolRequestParams { Name = tool, Arguments = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(arguments) });

        Assert.True(result.IsError);
        Assert.Equal(("invalid_arguments", field), (Code(result), Structured(result).GetProperty("field").GetString()));
        Assert.Empty(await Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task DaySummary_AlwaysNamesTheZoneItUsed_RequestedOrUtc()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject));

        var requested = await client.CallToolAsync("get_day_summary", Args(("timeZone", "America/Sao_Paulo")));
        var unknown = await client.CallToolAsync("get_week_summary", Args());

        Assert.Equal(("America/Sao_Paulo", "requested"), (Structured(requested).GetProperty("timeZone").GetString(), Structured(requested).GetProperty("timeZoneSource").GetString()));
        Assert.Equal(("UTC", "utc"), (Structured(unknown).GetProperty("timeZone").GetString(), Structured(unknown).GetProperty("timeZoneSource").GetString()));
        Assert.Contains("days in UTC", Text(unknown), StringComparison.Ordinal);
        Assert.Equal(7, Structured(unknown).GetProperty("days").GetArrayLength());
    }

    [Fact]
    public async Task ListTools_EveryToolButListBabies_TakesATimeZone()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var tools = (await client.ListToolsAsync()).Select(tool => tool.ProtocolTool).ToArray();

        Assert.Equal(["list_babies"], tools.Where(tool => !tool.InputSchema.GetProperty("properties").TryGetProperty("timeZone", out _)).Select(tool => tool.Name));
    }

    [Fact]
    public async Task Call_UnknownTool_IsAProtocolError()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var error = await Assert.ThrowsAsync<ModelContextProtocol.McpProtocolException>(async () => await client.CallToolAsync("log_medication_dose", Args()));

        Assert.Equal(ModelContextProtocol.McpErrorCode.InvalidParams, error.ErrorCode);
    }

    [Fact]
    public async Task Roles_ViewerWithTheWriteScope_IsNotAllowed_DoctorIsRefusedEverything()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Viewer, BabyRole.Doctor);
        await using var viewer = await host.ClientAsync(host.TokenFor(baby.SubjectOf(BabyRole.Viewer), McpApiHost.ReadWrite));
        await using var doctor = await host.ClientAsync(host.TokenFor(baby.SubjectOf(BabyRole.Doctor), McpApiHost.ReadWrite));

        var viewerWrite = await viewer.CallToolAsync("log_diaper", Args(("kind", "wet")));
        var viewerRead = await viewer.CallToolAsync("get_diapers_today", Args());
        var doctorRead = await doctor.CallToolAsync("get_last_feed", Args(("babyId", baby.BabyId.ToString())));
        var doctorList = await doctor.CallToolAsync("list_babies", Args());

        Assert.Equal((true, "not_allowed"), (viewerWrite.IsError, Code(viewerWrite)));
        Assert.Equal((false, "diapers_today"), (viewerRead.IsError ?? false, Code(viewerRead)));
        Assert.Equal((true, "not_allowed"), (doctorRead.IsError, Code(doctorRead)));
        Assert.Equal((true, "not_allowed"), (doctorList.IsError, Code(doctorList)));
        Assert.False(Structured(doctorRead).TryGetProperty("baby", out _));
        Assert.Empty(await Factory.EventsAsync(baby.BabyId));
    }

    [Fact]
    public async Task Roles_CaregiverStopsOnlyWhatTheRulesAllow_AndLogsAsHerself()
    {
        var baby = await Factory.SeedBabyAsync(BabyRole.Caregiver);
        var caregiver = baby.SubjectOf(BabyRole.Caregiver);
        await Factory.PutEventAsync(baby.OwnerSubject, baby.BabyId, BuiltInEventTypes.SleepId, DateTimeOffset.UtcNow.AddMinutes(-30), null, """{"kind":"nap"}""");
        await using var client = await host.ClientAsync(host.TokenFor(caregiver, McpApiHost.ReadWrite));

        var woke = await client.CallToolAsync("log_sleep_end", Args());
        var diaper = await client.CallToolAsync("log_diaper", Args(("kind", "dirty")));

        Assert.Equal(("sleep_ended", "diaper_logged"), (Code(woke), Code(diaper)));
        var caregiverId = await Factory.UserIdAsync(caregiver);
        Assert.Equal(2, (await Factory.EventsAsync(baby.BabyId)).Count(stored => stored.CreatedBy == caregiverId));
    }

    [Fact]
    public async Task BabyChoice_SeveralBabies_ChooseBabyNamesListBabies_ThenBabyIdWorks()
    {
        var (subject, babyIds) = await Factory.SeedMemberOfAsync(BabyRole.Parent, BabyRole.Parent);
        await using var client = await host.ClientAsync(host.TokenFor(subject, McpApiHost.ReadWrite));

        var unnamed = await client.CallToolAsync("log_diaper", Args(("kind", "wet")));
        var listed = await client.CallToolAsync("list_babies", Args());
        var named = await client.CallToolAsync("log_diaper", Args(("kind", "wet"), ("babyId", babyIds[1].ToString())));
        var foreign = await client.CallToolAsync("get_last_feed", Args(("babyId", Guid.NewGuid().ToString())));

        Assert.Equal((true, "choose_baby"), (unnamed.IsError, Code(unnamed)));
        Assert.Contains("list_babies", Text(unnamed), StringComparison.Ordinal);
        Assert.Equal(babyIds.Order(), Structured(listed).GetProperty("babies").EnumerateArray().Select(baby => baby.GetProperty("id").GetGuid()).Order());
        Assert.Equal(("diaper_logged", babyIds[1]), (Code(named), Structured(named).GetProperty("baby").GetProperty("id").GetGuid()));
        Assert.Equal((true, "unknown_baby"), (foreign.IsError, Code(foreign)));
    }

    [Fact]
    public async Task Results_NeverCarryStackTracesOrInternalIds()
    {
        var baby = await Factory.SeedBabyAsync();
        await using var client = await host.ClientAsync(host.TokenFor(baby.OwnerSubject, McpApiHost.ReadWrite));

        var result = await client.CallToolAsync("log_sleep_start", Args());
        var json = JsonSerializer.Serialize(Structured(result));

        Assert.DoesNotContain("createdBy", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("userId", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(" at Lotties.", Text(result), StringComparison.Ordinal);
    }

    internal static Dictionary<string, object?> Args(params (string Name, object? Value)[] arguments) =>
        arguments.ToDictionary(argument => argument.Name, argument => argument.Value);

    internal static JsonElement Structured(CallToolResult result) => result.StructuredContent!.Value;

    internal static string Code(CallToolResult result) => Structured(result).GetProperty("code").GetString()!;

    internal static string Text(CallToolResult result) => ((TextContentBlock)result.Content[0]).Text;
}
