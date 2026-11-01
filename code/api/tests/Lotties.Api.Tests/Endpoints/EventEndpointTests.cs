using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Lotties.Api.Endpoints;
using Lotties.Api.Errors;
using Lotties.Api.Serialization;
using Lotties.Api.Tests.Support;
using Lotties.Application.Events;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Api.Tests.Endpoints;

public sealed class EventEndpointTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DateTimeOffset Start = new(2026, 1, 10, 8, 0, 0, TimeSpan.Zero);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new EventPayloadJsonConverter() },
    };

    [Fact]
    public async Task Put_NewEvent_Returns201WithLocationAndServerStampedUpdatedAt()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var before = DateTimeOffset.UtcNow.AddSeconds(-1);

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(updatedAt: Start.AddYears(-1)));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal(EventPath(baby.BabyId, eventId), response.Headers.Location?.OriginalString);
        var created = await ReadEventAsync(response);
        Assert.Equal((eventId, baby.BabyId, BuiltInEventTypes.FeedingId, Start, (string?)"first"), (created.Id, created.BabyId, created.TypeId, created.StartedAt, created.Notes));
        Assert.True(created.UpdatedAt >= before && created.UpdatedAt <= DateTimeOffset.UtcNow.AddSeconds(1));
        Assert.Equal(await UserIdAsync(baby.OwnerSubject), created.CreatedBy);
        Assert.True(EventPayload.From("""{"method":"bottle","amount":120}""").IsEquivalentTo(created.Payload));
    }

    [Fact]
    public async Task Put_SameRequestTwice_ReturnsSameRepresentationAndKeepsOneRow()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        var first = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body()));

        var replay = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());

        Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
        Assert.Equal(first, await ReadEventAsync(replay));
        Assert.Equal(1, await CountEventsAsync(eventId));
    }

    [Fact]
    public async Task Put_ChangedDetails_EditsAndBumpsUpdatedAt()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var eventId = Guid.NewGuid();
        var first = await ReadEventAsync(await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body()));

        var response = await Member(baby, BabyRole.Parent).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "second", endedAt: Start.AddMinutes(20)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var edited = await ReadEventAsync(response);
        Assert.Equal(("second", (DateTimeOffset?)Start.AddMinutes(20), first.CreatedAt, first.CreatedBy), (edited.Notes, edited.EndedAt, edited.CreatedAt, edited.CreatedBy));
        Assert.True(edited.UpdatedAt > first.UpdatedAt);
    }

    [Fact]
    public async Task Put_ClientUpdatedAtOlderThanStored_IsIgnoredAndReturnsStored()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        var stored = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body()));

        var response = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "stale", updatedAt: stored.UpdatedAt.AddMinutes(-1)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(stored, await ReadEventAsync(response));
    }

    [Fact]
    public async Task Put_ClientUpdatedAtNewerThanStored_IsApplied()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        var stored = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body()));

        var response = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "newer", updatedAt: stored.UpdatedAt.AddSeconds(1)));

        Assert.Equal("newer", (await ReadEventAsync(response)).Notes);
    }

    [Fact]
    public async Task Put_OfflineCreateThenStop_StopNewerThanClientCreateIsAppliedThoughOlderThanServerReceipt()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        var createdOffline = DateTimeOffset.UtcNow.AddHours(-2);
        var created = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(updatedAt: createdOffline)));

        var stopped = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(endedAt: Start.AddMinutes(15), updatedAt: createdOffline.AddMinutes(15))));

        Assert.True(created.UpdatedAt > createdOffline.AddMinutes(15));
        Assert.Equal(Truncated(createdOffline), created.ClientUpdatedAt);
        Assert.Equal(Start.AddMinutes(15), stopped.EndedAt);
        Assert.Equal(Truncated(createdOffline.AddMinutes(15)), stopped.ClientUpdatedAt);
        Assert.True(stopped.UpdatedAt >= created.UpdatedAt);
    }

    [Fact]
    public async Task Put_OlderClientEditAfterNewerOne_IsIgnoredAndReturnsStored()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var eventId = Guid.NewGuid();
        var offline = DateTimeOffset.UtcNow.AddHours(-1);
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(updatedAt: offline));
        var newer = await ReadEventAsync(await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "newer", updatedAt: offline.AddMinutes(20))));

        var response = await Member(baby, BabyRole.Parent).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "older", updatedAt: offline.AddMinutes(10)));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(newer, await ReadEventAsync(response));
    }

    [Fact]
    public async Task Put_ClientClockFarAhead_IsClampedToServerTime()
    {
        var baby = await factory.SeedBabyAsync();

        var created = await ReadEventAsync(await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body(updatedAt: DateTimeOffset.UtcNow.AddDays(1))));

        Assert.Equal(created.UpdatedAt, created.ClientUpdatedAt);
    }

    [Fact]
    public async Task Put_ClientClockFarAhead_DoesNotLockOutLaterEditsFromOtherClients()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Parent);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(updatedAt: DateTimeOffset.UtcNow.AddDays(1)));

        var edited = await ReadEventAsync(await Member(baby, BabyRole.Parent).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "later", updatedAt: DateTimeOffset.UtcNow.AddSeconds(1))));

        Assert.Equal("later", edited.Notes);
    }

    [Fact]
    public async Task Put_ReplayWithClientUpdatedAt_ReturnsSameRepresentation()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        var body = Body(notes: "edit", updatedAt: DateTimeOffset.UtcNow.AddMinutes(-5));
        await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(updatedAt: DateTimeOffset.UtcNow.AddMinutes(-10)));
        var first = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), body));

        var replay = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), body));

        Assert.Equal(first, replay);
    }

    [Fact]
    public async Task Delete_AfterClientEditAheadOfServer_StillDeletesAndStampsServerTime()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(updatedAt: DateTimeOffset.UtcNow.AddMinutes(4)));

        await client.DeleteAsync(EventPath(baby.BabyId, eventId));

        var deleted = await ReadEventAsync(await client.GetAsync(EventPath(baby.BabyId, eventId)));
        Assert.Equal((deleted.DeletedAt, deleted.DeletedAt), (deleted.UpdatedAt, deleted.ClientUpdatedAt));
    }

    [Fact]
    public async Task Delta_OrdersByServerReceiptNotByClientEditTime()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);
        var editedRecently = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body(updatedAt: DateTimeOffset.UtcNow)));
        var editedLongAgoPushedLater = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body(updatedAt: DateTimeOffset.UtcNow.AddDays(-1))));

        var items = await ReadEventsAsync(await client.GetAsync(EventsPath(baby.BabyId, $"?since={Uri.EscapeDataString(editedRecently.UpdatedAt.ToString("O"))}")));

        Assert.Equal(new[] { editedRecently.Id, editedLongAgoPushedLater.Id }, items.Select(item => item.Id));
        Assert.True(items[1].ClientUpdatedAt < items[0].ClientUpdatedAt);
    }

    [Fact]
    public async Task Put_DeletedEvent_IsNoOpReturningDeletedRepresentation()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());
        await client.DeleteAsync(EventPath(baby.BabyId, eventId));
        var deleted = await ReadEventAsync(await client.GetAsync(EventPath(baby.BabyId, eventId)));

        var response = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(notes: "revive"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await ReadEventAsync(response);
        Assert.Equal(deleted, body);
        Assert.NotNull(body.DeletedAt);
    }

    [Fact]
    public async Task Put_CustomTypeOfSameBaby_Returns201()
    {
        var baby = await factory.SeedBabyAsync();
        var customTypeId = await SeedCustomTypeAsync(baby.BabyId);

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body(typeId: customTypeId));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    [Fact]
    public async Task Put_TypeOfAnotherBaby_Returns422AndStoresNothing()
    {
        var baby = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var foreignTypeId = await SeedCustomTypeAsync(other.BabyId);
        var eventId = Guid.NewGuid();

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(typeId: foreignTypeId));

        await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "event_type_not_available");
        Assert.Equal(0, await CountEventsAsync(eventId));
    }

    [Fact]
    public async Task Put_EditToTypeOfAnotherBaby_Returns422()
    {
        var baby = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var foreignTypeId = await SeedCustomTypeAsync(other.BabyId);
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());

        var response = await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body(typeId: foreignTypeId));

        await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "event_type_not_available");
    }

    [Fact]
    public async Task Put_UnknownType_Returns422()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body(typeId: Guid.NewGuid()));

        await AssertProblemAsync(response, HttpStatusCode.UnprocessableEntity, "event_type_not_available");
    }

    [Fact]
    public async Task Put_IdOfAnotherBabysEvent_Returns409AndLeavesItUnchanged()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var original = await ReadEventAsync(await Owner(other).PutAsJsonAsync(EventPath(other.BabyId, eventId), Body()));

        var response = await Owner(mine).PutAsJsonAsync(EventPath(mine.BabyId, eventId), Body(notes: "moved"));

        await AssertProblemAsync(response, HttpStatusCode.Conflict, "event_baby_mismatch");
        Assert.Equal(original, await ReadEventAsync(await Owner(other).GetAsync(EventPath(other.BabyId, eventId))));
    }

    [Fact]
    public async Task Put_ConcurrentCreatesOfOneId_StoreOneRowAndCreateOnce()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);

        var responses = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body())));

        Assert.All(responses, response => Assert.True(response.IsSuccessStatusCode, response.StatusCode.ToString()));
        Assert.Single(responses, response => response.StatusCode == HttpStatusCode.Created);
        Assert.Equal(1, await CountEventsAsync(eventId));
    }

    [Fact]
    public async Task Put_NotesTooLong_Returns400Problem()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body(notes: new string('n', Event.NotesMaxLength + 1)));

        var problem = await AssertProblemAsync(response, HttpStatusCode.BadRequest, "validation_failed");
        Assert.Equal("Notes", problem.GetProperty(DomainExceptionHandler.FieldExtension).GetString());
    }

    [Fact]
    public async Task Put_PayloadTooLarge_Returns400Problem()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body(payload: new { text = new string('a', EventPayload.MaxLength) }));

        await AssertProblemAsync(response, HttpStatusCode.BadRequest, "validation_failed");
    }

    [Theory]
    [InlineData("[1,2]")]
    [InlineData("42")]
    [InlineData("\"text\"")]
    public async Task Put_PayloadNotAnObject_Returns400Problem(string payloadJson)
    {
        var baby = await factory.SeedBabyAsync();
        var json = $$"""{"typeId":"{{BuiltInEventTypes.SleepId}}","startedAt":"2026-01-10T08:00:00Z","payload":{{payloadJson}}}""";

        var response = await PutRawAsync(Owner(baby), EventPath(baby.BabyId, Guid.NewGuid()), json);

        await AssertProblemAsync(response, HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Put_PayloadNullOrMissing_StoresEmptyObject()
    {
        var baby = await factory.SeedBabyAsync();
        var json = $$"""{"typeId":"{{BuiltInEventTypes.SleepId}}","startedAt":"2026-01-10T08:00:00Z","payload":null}""";

        var response = await PutRawAsync(Owner(baby), EventPath(baby.BabyId, Guid.NewGuid()), json);

        Assert.Equal("{}", (await ReadEventAsync(response)).Payload.Value);
    }

    [Fact]
    public async Task Put_EndBeforeStart_Returns400Problem()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body(endedAt: Start.AddMinutes(-1)));

        await AssertProblemAsync(response, HttpStatusCode.BadRequest, "event_invalid_time_range");
    }

    [Theory]
    [InlineData("{not json")]
    [InlineData("""{"startedAt":"2026-01-10T08:00:00Z"}""")]
    [InlineData("""{"typeId":"not-a-guid","startedAt":"2026-01-10T08:00:00Z"}""")]
    [InlineData("""{"typeId":"e6428ccb-7061-4cf4-a5d0-67c89a396a5f","startedAt":"yesterday"}""")]
    public async Task Put_MalformedBody_Returns400Problem(string json)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await PutRawAsync(Owner(baby), EventPath(baby.BabyId, Guid.NewGuid()), json);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Put_EmptyEventId_Returns400Problem()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, Guid.Empty), Body());

        await AssertProblemAsync(response, HttpStatusCode.BadRequest, "validation_failed");
    }

    [Fact]
    public async Task Put_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Put_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Put_Viewer_Returns403AndStoresNothing()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var eventId = Guid.NewGuid();

        var response = await Member(baby, BabyRole.Viewer).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await CountEventsAsync(eventId));
    }

    [Fact]
    public async Task Delete_Viewer_Returns403AndKeepsEvent()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var eventId = Guid.NewGuid();
        await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());

        var response = await Member(baby, BabyRole.Viewer).DeleteAsync(EventPath(baby.BabyId, eventId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Null(await DeletedAtAsync(eventId));
    }

    [Fact]
    public async Task Delete_Existing_Returns204AndSoftDeletes()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        var created = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body()));

        var response = await client.DeleteAsync(EventPath(baby.BabyId, eventId));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        var deleted = await ReadEventAsync(await client.GetAsync(EventPath(baby.BabyId, eventId)));
        Assert.NotNull(deleted.DeletedAt);
        Assert.Equal(deleted.DeletedAt, deleted.UpdatedAt);
        Assert.True(deleted.UpdatedAt >= created.UpdatedAt);
    }

    [Fact]
    public async Task Delete_Twice_Returns204AndKeepsFirstDeletion()
    {
        var baby = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        var client = Owner(baby);
        await client.PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body());
        await client.DeleteAsync(EventPath(baby.BabyId, eventId));
        var firstDeletion = await DeletedAtAsync(eventId);

        var response = await client.DeleteAsync(EventPath(baby.BabyId, eventId));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(firstDeletion, await DeletedAtAsync(eventId));
    }

    [Fact]
    public async Task Delete_UnknownEvent_Returns204()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).DeleteAsync(EventPath(baby.BabyId, Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Delete_IdOfAnotherBabysEvent_Returns204AndLeavesItAlone()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        await Owner(other).PutAsJsonAsync(EventPath(other.BabyId, eventId), Body());

        var response = await Owner(mine).DeleteAsync(EventPath(mine.BabyId, eventId));

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Null(await DeletedAtAsync(eventId));
    }

    [Fact]
    public async Task Get_ExistingAsViewer_Returns200()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var eventId = Guid.NewGuid();
        var created = await ReadEventAsync(await Owner(baby).PutAsJsonAsync(EventPath(baby.BabyId, eventId), Body()));

        var response = await Member(baby, BabyRole.Viewer).GetAsync(EventPath(baby.BabyId, eventId));

        Assert.Equal(created, await ReadEventAsync(response));
    }

    [Fact]
    public async Task Get_Unknown_Returns404Problem()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).GetAsync(EventPath(baby.BabyId, Guid.NewGuid()));

        await AssertProblemAsync(response, HttpStatusCode.NotFound, "event_not_found");
    }

    [Fact]
    public async Task Get_EventOfAnotherBaby_Returns404()
    {
        var mine = await factory.SeedBabyAsync();
        var other = await factory.SeedBabyAsync();
        var eventId = Guid.NewGuid();
        await Owner(other).PutAsJsonAsync(EventPath(other.BabyId, eventId), Body());

        var response = await Owner(mine).GetAsync(EventPath(mine.BabyId, eventId));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Get_NonMember_Returns403()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClientFor(TestUsers.NewSubject()).GetAsync(EventsPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Get_Anonymous_Returns401()
    {
        var baby = await factory.SeedBabyAsync();

        var response = await factory.CreateClient().GetAsync(EventsPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Delta_NoSince_ReturnsAllEventsIncludingDeletedOrderedByUpdatedAt()
    {
        var baby = await factory.SeedBabyAsync(BabyRole.Viewer);
        var other = await factory.SeedBabyAsync();
        var ownerId = await UserIdAsync(baby.OwnerSubject);
        var first = SeedEvent(baby.BabyId, ownerId, Start.AddMinutes(1));
        var deleted = SeedEvent(baby.BabyId, ownerId, Start.AddMinutes(2));
        var third = SeedEvent(baby.BabyId, ownerId, Start.AddMinutes(3));
        deleted.SoftDelete(Start.AddMinutes(4));
        await SeedEventsAsync(first, deleted, third, SeedEvent(other.BabyId, await UserIdAsync(other.OwnerSubject), Start));

        var response = await Member(baby, BabyRole.Viewer).GetAsync(EventsPath(baby.BabyId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var items = await ReadEventsAsync(response);
        Assert.Equal(new[] { first.Id, third.Id, deleted.Id }, items.Select(item => item.Id));
        Assert.Equal(Start.AddMinutes(4), items[2].DeletedAt);
        Assert.False(response.Headers.Contains(EventEndpoints.NextCursorHeader));
    }

    [Fact]
    public async Task Delta_Since_ReturnsEventsUpdatedAtOrAfterIt()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await UserIdAsync(baby.OwnerSubject);
        var older = SeedEvent(baby.BabyId, ownerId, Start.AddMinutes(1));
        var atSince = SeedEvent(baby.BabyId, ownerId, Start.AddMinutes(2));
        var newer = SeedEvent(baby.BabyId, ownerId, Start.AddMinutes(3));
        await SeedEventsAsync(older, atSince, newer);
        var since = Uri.EscapeDataString(Start.AddMinutes(2).ToOffset(TimeSpan.FromHours(-3)).ToString("O"));

        var items = await ReadEventsAsync(await Owner(baby).GetAsync(EventsPath(baby.BabyId, $"?since={since}")));

        Assert.Equal(new[] { atSince.Id, newer.Id }, items.Select(item => item.Id));
    }

    [Fact]
    public async Task Delta_PagesThroughTiedUpdatedAt_ReturnsEveryEventOnceInIdOrder()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await UserIdAsync(baby.OwnerSubject);
        var tied = Enumerable.Range(0, 5).Select(_ => SeedEvent(baby.BabyId, ownerId, Start.AddMinutes(5))).ToArray();
        var later = SeedEvent(baby.BabyId, ownerId, Start.AddMinutes(6));
        await SeedEventsAsync([.. tied, later]);
        var expected = tied.Select(item => item.Id).Order().Append(later.Id).ToArray();

        var pages = await PullAllPagesAsync(Owner(baby), baby.BabyId, $"?since={Uri.EscapeDataString(Start.AddMinutes(5).ToString("O"))}&limit=2");

        Assert.Equal(new[] { 2, 2, 2 }, pages.Select(page => page.Count));
        Assert.Equal(expected, pages.SelectMany(page => page).Select(item => item.Id));
    }

    [Fact]
    public async Task Delta_ExactlyFullLastPage_HasNoNextCursor()
    {
        var baby = await factory.SeedBabyAsync();
        var ownerId = await UserIdAsync(baby.OwnerSubject);
        await SeedEventsAsync(SeedEvent(baby.BabyId, ownerId, Start), SeedEvent(baby.BabyId, ownerId, Start.AddMinutes(1)));

        var response = await Owner(baby).GetAsync(EventsPath(baby.BabyId, "?limit=2"));

        Assert.Equal(2, (await ReadEventsAsync(response)).Count);
        Assert.False(response.Headers.Contains(EventEndpoints.NextCursorHeader));
    }

    [Fact]
    public async Task Delta_EventUpsertedAfterCursor_AppearsOnNextPull()
    {
        var baby = await factory.SeedBabyAsync();
        var client = Owner(baby);
        var first = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, Guid.NewGuid()), Body()));
        var since = Uri.EscapeDataString(first.UpdatedAt.ToString("O"));
        var edited = await ReadEventAsync(await client.PutAsJsonAsync(EventPath(baby.BabyId, first.Id), Body(notes: "edited")));

        var items = await ReadEventsAsync(await client.GetAsync(EventsPath(baby.BabyId, $"?since={since}")));

        Assert.Equal(edited, Assert.Single(items));
    }

    [Theory]
    [InlineData("?after=garbage")]
    [InlineData("?limit=0")]
    [InlineData("?limit=501")]
    [InlineData("?limit=abc")]
    [InlineData("?since=yesterday")]
    public async Task Delta_InvalidQuery_Returns400Problem(string query)
    {
        var baby = await factory.SeedBabyAsync();

        var response = await Owner(baby).GetAsync(EventsPath(baby.BabyId, query));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    private static DateTimeOffset Truncated(DateTimeOffset value) => new(value.UtcTicks - (value.UtcTicks % 10), TimeSpan.Zero);

    private static string EventsPath(Guid babyId, string query = "") => $"/api/v1/babies/{babyId}/events{query}";

    private static string EventPath(Guid babyId, Guid eventId) => $"/api/v1/babies/{babyId}/events/{eventId}";

    private static object Body(
        Guid? typeId = null,
        string? notes = "first",
        object? payload = null,
        DateTimeOffset? endedAt = null,
        DateTimeOffset? updatedAt = null) => new
        {
            typeId = typeId ?? BuiltInEventTypes.FeedingId,
            startedAt = Start,
            endedAt,
            payload = payload ?? new { method = "bottle", amount = 120 },
            notes,
            updatedAt,
        };

    private static Event SeedEvent(Guid babyId, Guid createdBy, DateTimeOffset updatedAt) =>
        Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.SleepId, createdBy, Start, null, EventPayload.Empty, null, updatedAt);

    private static Task<HttpResponseMessage> PutRawAsync(HttpClient client, string path, string json) =>
        client.PutAsync(path, new StringContent(json, Encoding.UTF8, "application/json"));

    private static async Task<EventResponse> ReadEventAsync(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<EventResponse>(Json))!;
    }

    private static async Task<List<EventResponse>> ReadEventsAsync(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<List<EventResponse>>(Json))!;
    }

    private static async Task<JsonElement> AssertProblemAsync(HttpResponseMessage response, HttpStatusCode status, string code)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal((int)status, problem.GetProperty("status").GetInt32());
        Assert.Equal(code, problem.GetProperty(DomainExceptionHandler.CodeExtension).GetString());
        return problem;
    }

    private static async Task<List<List<EventResponse>>> PullAllPagesAsync(HttpClient client, Guid babyId, string firstQuery)
    {
        var pages = new List<List<EventResponse>>();
        var query = firstQuery;
        while (query is not null)
        {
            var response = await client.GetAsync(EventsPath(babyId, query));
            pages.Add(await ReadEventsAsync(response));
            query = response.Headers.TryGetValues(EventEndpoints.NextCursorHeader, out var cursors)
                ? $"{firstQuery}&after={Uri.EscapeDataString(cursors.Single())}"
                : null;
        }

        return pages;
    }

    private HttpClient Owner(SeededBaby baby) => factory.CreateClientFor(baby.OwnerSubject);

    private HttpClient Member(SeededBaby baby, BabyRole role) => factory.CreateClientFor(baby.SubjectOf(role));

    private Task SeedEventsAsync(params Event[] events) => factory.SeedAsync(context =>
    {
        context.Events.AddRange(events);
        return Task.CompletedTask;
    });

    private async Task<Guid> SeedCustomTypeAsync(Guid babyId)
    {
        var eventType = EventType.CreateCustom(babyId, EventTypeKey.From("pumping"), "Pumping", "water_drop", HexColor.From("#123456"), hasDuration: true, []);
        await factory.SeedAsync(context =>
        {
            context.EventTypes.Add(eventType);
            return Task.CompletedTask;
        });
        return eventType.Id;
    }

    private Task<Guid> UserIdAsync(string subject) =>
        factory.QueryAsync(context => context.Users.Where(user => user.Subject == subject).Select(user => user.Id).SingleAsync());

    private Task<int> CountEventsAsync(Guid eventId) =>
        factory.QueryAsync(context => context.EventsIncludingDeleted.CountAsync(stored => stored.Id == eventId));

    private Task<DateTimeOffset?> DeletedAtAsync(Guid eventId) =>
        factory.QueryAsync(context => context.EventsIncludingDeleted.Where(stored => stored.Id == eventId).Select(stored => stored.DeletedAt).SingleAsync());
}
