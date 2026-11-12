using System.Text.Json;
using Lotties.Application.Events;
using Lotties.Application.Stores;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Users;
using Lotties.Postgres.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Postgres.Tests.Persistence;

/// <summary>
/// Events on the real <c>events</c> table of a migrated Lotties database, for what the SQLite host cannot check: the payload is a
/// <c>jsonb</c> object (not a JSON string) that round-trips through the EF converter and answers the jsonb operators; the column
/// keeps microseconds; and the sync contract (SPEC "Events sync contract": the client <c>updatedAt</c> against the stored
/// <c>ClientUpdatedAt</c>, a replay changes nothing although <c>jsonb</c> reorders the members) holds through the event service
/// when every request re-reads the row; a second create of the same client id hits the primary key and is recognized as one.
/// Events carry no row version: the stored <c>ClientUpdatedAt</c> is their whole conflict rule.
/// </summary>
[Collection(PostgresCollection.Name)]
[Trait("Category", PostgresCollection.Category)]
public sealed class EventJsonbPostgresTests(PostgresFixture postgres)
{
    private static readonly DateTimeOffset Now = new(2026, 11, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>Nested objects and arrays, unicode (accents, CJK, an emoji, an escaped quote), integers, decimals, negatives, booleans and null.</summary>
    private const string RichPayload = """
        {"zeta":1,"kind":"nap","nested":{"deep":{"list":[1,2.5,-3,true,false,null,"x"],"empty":{}},"name":"Lótus 小 🍼 \"q\""},
         "amount_ml":120,"ratio":0.125,"big":12345678901234,"negative":-42,"missing":null,"flag":true,"tags":["night","formula"]}
        """;

    [PostgresFact]
    public async Task Payload_round_trips_through_the_jsonb_column_as_the_same_json_value()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "jsonbtrip");
        var (ownerId, babyId) = await AddFamilyAsync(world);
        var eventId = Guid.NewGuid();
        await using (var context = world.NewContext())
        {
            context.Events.Add(Event.Create(eventId, babyId, BuiltInEventTypes.SleepId, ownerId, Now, Now.AddHours(1), EventPayload.From(RichPayload), "Nota ✓", Now));
            await context.SaveChangesAsync();
        }

        await using var reader = world.NewContext();
        var stored = await reader.Events.AsNoTracking().SingleAsync(item => item.Id == eventId);

        Assert.True(EventPayload.From(RichPayload).IsEquivalentTo(stored.Payload), stored.Payload.Value);
        using var document = JsonDocument.Parse(stored.Payload.Value);
        var nested = document.RootElement.GetProperty("nested");
        Assert.Equal("Lótus 小 🍼 \"q\"", nested.GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("missing").ValueKind);
        Assert.Equal(12345678901234L, document.RootElement.GetProperty("big").GetInt64());
        Assert.Equal(0.125m, document.RootElement.GetProperty("ratio").GetDecimal());
        Assert.Equal("Nota ✓", stored.Notes);
        Assert.Equal("jsonb", await ColumnTypeAsync(world, "payload"));
    }

    [PostgresFact]
    public async Task Stored_payload_is_a_jsonb_object_that_answers_the_jsonb_operators()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "jsonbops");
        var (ownerId, babyId) = await AddFamilyAsync(world);
        var rich = Guid.NewGuid();
        await using (var context = world.NewContext())
        {
            context.Events.Add(Event.Create(rich, babyId, BuiltInEventTypes.SleepId, ownerId, Now, Now.AddHours(1), EventPayload.From(RichPayload), null, Now));
            context.Events.Add(Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.DiaperId, ownerId, Now, Now, EventPayload.From("""{"content":"WET"}"""), null, Now));
            await context.SaveChangesAsync();
        }

        var where = $"WHERE id = '{rich}'";
        Assert.Equal("object", await postgres.ScalarAsync<string>($"SELECT jsonb_typeof(payload) FROM events {where}", world.Database));
        Assert.Equal(120, await postgres.ScalarAsync<int>($"SELECT (payload->>'amount_ml')::int FROM events {where}", world.Database));
        Assert.Equal("Lótus 小 🍼 \"q\"", await postgres.ScalarAsync<string>($"SELECT payload #>> '{{nested,name}}' FROM events {where}", world.Database));
        Assert.Equal("null", await postgres.ScalarAsync<string>($"SELECT jsonb_typeof(payload->'missing') FROM events {where}", world.Database));
        Assert.Equal(2.5m, await postgres.ScalarAsync<decimal>($"SELECT (payload #>> '{{nested,deep,list,1}}')::numeric FROM events {where}", world.Database));
        Assert.Equal(1L, await postgres.ScalarAsync<long>($$"""SELECT count(*) FROM events WHERE baby_id = '{{babyId}}' AND payload @> '{"tags":["night"]}'""", world.Database));
        Assert.Equal(1L, await postgres.ScalarAsync<long>($"SELECT count(*) FROM events WHERE baby_id = '{babyId}' AND payload ? 'content'", world.Database));
    }

    [PostgresFact]
    public async Task Event_service_applies_the_sync_contract_on_rows_read_back_from_postgres()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "jsonbsync");
        var (ownerId, babyId) = await AddFamilyAsync(world);
        var eventId = Guid.NewGuid();
        // 100-ns ticks below the microsecond: the domain truncates them and timestamptz keeps microseconds, so the replay below is equal.
        var clientEdit = Now.AddTicks(1_234_567);
        // jsonb stores members by key length then key: sent in the opposite order, so the stored text differs from what was sent.
        const string sent = """{"time_to_fall_asleep_minutes":15,"mood_on_wake":"good","how_slept":"held","kind":"nap"}""";

        var created = await UpsertAsync(world, ownerId, babyId, eventId, sent, clientEdit);
        Assert.True(created.Created);
        var stored = await ReadAsync(world, eventId);
        Assert.Equal(UtcTimeOf(clientEdit), stored.ClientUpdatedAt);
        Assert.NotEqual(sent, stored.Payload.Value);

        var replay = await UpsertAsync(world, ownerId, babyId, eventId, sent, clientEdit);
        Assert.False(replay.Created);
        var afterReplay = await ReadAsync(world, eventId);
        Assert.Equal(stored.UpdatedAt, afterReplay.UpdatedAt);
        Assert.Equal(stored.ClientUpdatedAt, afterReplay.ClientUpdatedAt);

        var stale = await UpsertAsync(world, ownerId, babyId, eventId, """{"kind":"nap","how_slept":"car"}""", clientEdit.AddMinutes(-1));
        Assert.Equal("held", stale.Event.Payload.GetString("how_slept"));
        var afterStale = await ReadAsync(world, eventId);
        Assert.Equal("held", afterStale.Payload.GetString("how_slept"));
        Assert.Equal(stored.UpdatedAt, afterStale.UpdatedAt);

        var newer = await UpsertAsync(world, ownerId, babyId, eventId, """{"kind":"nap","how_slept":"car"}""", clientEdit.AddMinutes(1));
        var afterNewer = await ReadAsync(world, eventId);
        Assert.Equal("car", newer.Event.Payload.GetString("how_slept"));
        Assert.Equal("car", afterNewer.Payload.GetString("how_slept"));
        Assert.Equal(UtcTimeOf(clientEdit.AddMinutes(1)), afterNewer.ClientUpdatedAt);
        Assert.True(afterNewer.UpdatedAt > stored.UpdatedAt);
    }

    [PostgresFact]
    public async Task Second_create_of_the_same_client_id_is_recognized_as_a_primary_key_violation()
    {
        await using var world = await BuiltInWorld.CreateAsync(postgres, "jsonbdup");
        var (ownerId, babyId) = await AddFamilyAsync(world);
        var eventId = Guid.NewGuid();
        await using var firstScope = world.Scope(ownerId);
        await using var secondScope = world.Scope(ownerId);
        var first = await EventsInAsync(firstScope, babyId);
        var second = await EventsInAsync(secondScope, babyId);

        Assert.True(await first.TryAddAsync(Diaper(eventId, babyId, ownerId, "WET")));
        Assert.False(await second.TryAddAsync(Diaper(eventId, babyId, ownerId, "DIRTY")));

        Assert.Equal("WET", await postgres.ScalarAsync<string>($"SELECT payload->>'content' FROM events WHERE id = '{eventId}'", world.Database));
        Assert.Equal("WET", (await second.FindAsync(eventId))!.Payload.GetString("content"));
    }

    private static Event Diaper(Guid eventId, Guid babyId, Guid ownerId, string content) =>
        Event.Create(eventId, babyId, BuiltInEventTypes.DiaperId, ownerId, Now, Now, EventPayload.From($$"""{"content":"{{content}}"}"""), null, Now);

    private static DateTimeOffset UtcTimeOf(DateTimeOffset value) =>
        new(value.UtcTicks - (value.UtcTicks % TimeSpan.TicksPerMicrosecond), TimeSpan.Zero);

    private static async Task<IEventRepository> EventsInAsync(AsyncServiceScope scope, Guid babyId)
    {
        await scope.ServiceProvider.GetRequiredService<IStoreScope>().EnterAsync(babyId);
        return scope.ServiceProvider.GetRequiredService<IEventRepository>();
    }

    /// <summary>One request: a fresh scope that enters the baby and upserts a finished nap as the owner.</summary>
    private static async Task<UpsertEventResult> UpsertAsync(BuiltInWorld world, Guid ownerId, Guid babyId, Guid eventId, string payload, DateTimeOffset clientUpdatedAt)
    {
        await using var scope = world.Scope(ownerId);
        await scope.ServiceProvider.GetRequiredService<IStoreScope>().EnterAsync(babyId);
        var request = new UpsertEventRequest
        {
            TypeId = BuiltInEventTypes.SleepId,
            StartedAt = Now.AddHours(-2),
            EndedAt = Now.AddHours(-1),
            Payload = EventPayload.From(payload),
            UpdatedAt = clientUpdatedAt,
        };
        return await scope.ServiceProvider.GetRequiredService<IEventService>().UpsertAsync(babyId, eventId, request);
    }

    private static async Task<Event> ReadAsync(BuiltInWorld world, Guid eventId)
    {
        await using var context = world.NewContext();
        return await context.Events.AsNoTracking().SingleAsync(item => item.Id == eventId);
    }

    private async Task<string?> ColumnTypeAsync(BuiltInWorld world, string column) =>
        await postgres.ScalarAsync<string>(
            $"SELECT data_type::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'events' AND column_name = '{column}'",
            world.Database);

    private static async Task<(Guid OwnerId, Guid BabyId)> AddFamilyAsync(BuiltInWorld world)
    {
        await using var context = world.NewContext();
        var owner = User.Create(User.UnknownIssuer, $"jsonb|{Guid.NewGuid():N}", "Owner", Now);
        var baby = Baby.Create("Lia", new DateOnly(2026, 8, 1), owner.Id, Now);
        context.Users.Add(owner);
        context.Babies.Add(baby);
        await context.SaveChangesAsync();
        return (owner.Id, baby.Id);
    }
}
