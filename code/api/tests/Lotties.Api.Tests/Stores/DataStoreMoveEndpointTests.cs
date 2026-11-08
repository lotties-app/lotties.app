using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Lotties.Api.Tests.Backups;
using Lotties.Api.Tests.Support;
using Lotties.Application.Stores;
using Lotties.Domain.Babies;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Exceptions;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence.Seed;
using Lotties.Infrastructure.Stores.Moves;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// Moving a baby's records between Lotties' database and the Owner's own database (docs/design/47-bring-your-own-database.md section 6,
/// task T7) through the routes, the background worker and two SQLite stores (the built-in one and the owner's): every one of the 12
/// data tables copied as stored (ids, authors, times, soft deletions, a former doctor's notes and proposals) except a private note of
/// another person, which never reaches the owner's database; the pointer and epoch switch after the copy; the old copy kept for the
/// undo window and then deleted by the sweep; writes refused with <c>503 store_moving</c> while a move runs; a failed copy leaves the baby
/// where it was; a stopped worker's move resumed; the Owner-only and not-needed refusals; log lines without ids or content.
/// </summary>
public sealed class DataStoreMoveEndpointTests(StoresApiFactory factory) : IClassFixture<StoresApiFactory>
{
    private static readonly DateTimeOffset Start = new(2026, 1, 10, 8, 0, 0, TimeSpan.Zero);
    private static readonly TimeSpan MoveTimeout = TimeSpan.FromMinutes(2);
    private const string DoctorPrivateNote = "Mother seemed anxious (doctor-only sentinel).";

    [Fact]
    public async Task MoveInThenOut_EveryDataTable_IsCopiedAsStoredAndThePointerSwitchesEachTime()
    {
        var family = await FamilyAsync(withDoctorHistory: true);
        var hosted = await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId));
        Assert.All(hosted, table => Assert.True(table.Value.Count > 0, $"{table.Key} has no row to move"));

        var started = await family.Owner.PostAsync(Route(family, "/move-in"), null);

        Assert.Equal(HttpStatusCode.Accepted, started.StatusCode);
        var accepted = await started.ReadAsync<DataStoreMoveStatus>();
        Assert.Equal(("in", "copying"), (accepted.Direction, accepted.State));
        var moved = await WaitForMoveAsync(family);
        Assert.Equal(("moved", true, (string?)null), (moved.State, moved.CanUndo, moved.FailureCode));
        Assert.NotNull(moved.OldCopyKeptUntil);
        var own = await factory.Stores.QueryAsync(family.StoreId, context => DataPlaneSnapshot.TakeAsync(context, family.BabyId));
        Assert.Equal(WithoutForeignPrivateNotes(hosted), own);
        Assert.Equal((family.StoreId, 1), await PointerAsync(family));
        Assert.Equal(hosted, await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId)));
        var notes = await family.Owner.GetAsync($"{BabyPath(family)}/notes");
        Assert.Equal("1", notes.Headers.GetValues("X-Sync-Epoch").Single());
        Assert.DoesNotContain(DoctorPrivateNote, await notes.Content.ReadAsStringAsync(), StringComparison.Ordinal);

        var back = await family.Owner.PostAsync(Route(family, "/move-out"), null);

        Assert.Equal(HttpStatusCode.Accepted, back.StatusCode);
        var returned = await WaitForMoveAsync(family);
        Assert.Equal(("out", "moved"), (returned.Direction, returned.State));
        Assert.Equal(((Guid?)null, 2), await PointerAsync(family));
        Assert.Equal(own, await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId)));
        Assert.Equal(own, await factory.Stores.QueryAsync(family.StoreId, context => DataPlaneSnapshot.TakeAsync(context, family.BabyId)));
        var events = await family.Owner.GetAsync($"{BabyPath(family)}/notes");
        Assert.Equal("2", events.Headers.GetValues("X-Sync-Epoch").Single());
    }

    [Fact]
    public async Task MoveInAndOut_ThreeThousandEvents_MoveInBatchesBothWays()
    {
        var family = await FamilyAsync(withDoctorHistory: false);
        await SeedEventsAsync(family, 3000);
        var hosted = await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId));

        await family.Owner.PostAsync(Route(family, "/move-in"), null).Ok();
        var moved = await WaitForMoveAsync(family);

        Assert.Equal(("moved", DataPlaneSnapshot.Count(hosted)), (moved.State, moved.RecordsTotal ?? 0));
        Assert.Equal(hosted, await factory.Stores.QueryAsync(family.StoreId, context => DataPlaneSnapshot.TakeAsync(context, family.BabyId)));

        await family.Owner.PostAsync(Route(family, "/move-out"), null).Ok();
        Assert.Equal("moved", (await WaitForMoveAsync(family)).State);

        Assert.Equal(hosted, await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId)));
        Assert.True(hosted["events"].Count > 3000);
    }

    [Fact]
    public async Task Write_WhileAMoveRuns_Is503StoreMovingAndReadsGoOn()
    {
        var family = await FamilyAsync(withDoctorHistory: false);
        await factory.SeedAsync(context =>
        {
            context.DataStoreMoves.Add(DataStoreMove.Start(family.BabyId, DataStoreMoveDirection.In, family.StoreId, "elsewhere", DateTimeOffset.UtcNow, TimeSpan.FromMinutes(10)));
            return Task.CompletedTask;
        });

        var write = await family.Owner.PutAsJsonAsync($"{BabyPath(family)}/events/{Guid.NewGuid()}", new { typeId = BuiltInEventTypes.DiaperId, startedAt = Start, payload = new { content = "WET" } });
        var read = await family.Owner.GetAsync($"{BabyPath(family)}/notes");
        var status = await (await family.Owner.GetAsync(Route(family))).ReadAsync<DataStoreStatusResponse>();
        var again = await family.Owner.PostAsync(Route(family, "/move-in"), null);

        await write.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_moving");
        Assert.Equal("15", write.Headers.GetValues("Retry-After").Single());
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Equal(("hosted", "copying"), (status.Kind, status.Move!.State));
        await again.AssertProblemAsync(HttpStatusCode.Conflict, "store_move_in_progress");
    }

    [Fact]
    public async Task MoveIn_TargetRefusesWrites_FailsLeavesTheBabyHostedAndTheOwnDatabaseEmpty()
    {
        var family = await FamilyAsync(withDoctorHistory: false);
        var hosted = await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId));
        factory.Stores.FaultsOf(family.StoreId).WriteFault = new StoreQuotaFullException();

        await family.Owner.PostAsync(Route(family, "/move-in"), null).Ok();
        var failed = await WaitForMoveAsync(family);

        Assert.Equal(("failed", "store_quota_full", false), (failed.State, failed.FailureCode, failed.CanUndo));
        Assert.Equal(((Guid?)null, 0), await PointerAsync(family));
        Assert.Equal(0, DataPlaneSnapshot.Count(await factory.Stores.QueryAsync(family.StoreId, context => DataPlaneSnapshot.TakeAsync(context, family.BabyId))));
        Assert.Equal(hosted, await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId)));
        await family.Owner.PutAsJsonAsync($"{BabyPath(family)}/events/{Guid.NewGuid()}", new { typeId = BuiltInEventTypes.DiaperId, startedAt = Start, payload = new { content = "WET" } }).Ok();

        factory.Stores.FaultsOf(family.StoreId).Clear();
        await family.Owner.PostAsync(Route(family, "/move-in"), null).Ok();
        Assert.Equal("moved", (await WaitForMoveAsync(family)).State);
    }

    [Fact]
    public async Task Sweep_MoveWhoseWorkerStopped_IsResumedAndSwitches()
    {
        var family = await FamilyAsync(withDoctorHistory: false);
        var hosted = await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId));
        await factory.SeedAsync(context =>
        {
            context.DataStoreMoves.Add(DataStoreMove.Start(family.BabyId, DataStoreMoveDirection.In, family.StoreId, "stopped-worker", DateTimeOffset.UtcNow.AddMinutes(-30), TimeSpan.FromMinutes(2)));
            return Task.CompletedTask;
        });

        await Worker().SweepOnceAsync(CancellationToken.None);

        var status = await StatusAsync(family);
        Assert.Equal("moved", status.Move!.State);
        Assert.Equal((family.StoreId, 1), await PointerAsync(family));
        Assert.Equal(hosted, await factory.Stores.QueryAsync(family.StoreId, context => DataPlaneSnapshot.TakeAsync(context, family.BabyId)));
        Assert.Equal(2, await factory.QueryAsync(context => context.DataStoreMoves.Where(move => move.BabyId == family.BabyId).Select(move => move.Attempt).SingleAsync()));
    }

    [Fact]
    public async Task Sweep_AfterTheUndoWindow_DeletesTheHostedCopyOnly()
    {
        var family = await FamilyAsync(withDoctorHistory: false);
        var hosted = await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId));
        await family.Owner.PostAsync(Route(family, "/move-in"), null).Ok();
        await WaitForMoveAsync(family);

        await Worker().SweepOnceAsync(CancellationToken.None);
        Assert.Equal(hosted, await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId)));
        await factory.QueryAsync(context => context.DataStoreMoves.Where(move => move.BabyId == family.BabyId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(move => move.NextCleanupAt, DateTimeOffset.UtcNow.AddMinutes(-1))));
        await Worker().SweepOnceAsync(CancellationToken.None);

        var status = await StatusAsync(family);
        Assert.Equal(("completed", false), (status.Move!.State, status.Move.CanUndo));
        Assert.NotNull(status.Move.OldCopyDeletedAt);
        Assert.Equal(0, DataPlaneSnapshot.Count(await factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, family.BabyId))));
        Assert.Equal(hosted, await factory.Stores.QueryAsync(family.StoreId, context => DataPlaneSnapshot.TakeAsync(context, family.BabyId)));
        await family.Owner.GetAsync($"{BabyPath(family)}/notes").Ok();
    }

    [Fact]
    public async Task MoveOut_MedicationLinkedToAProductLottiesNoLongerHas_MovesBackWithoutTheLink()
    {
        var family = await FamilyAsync(withDoctorHistory: false);
        var productId = (await (await family.Owner.PostAsJsonAsync("/api/v1/catalog/products", new { name = $"Movesol {Guid.NewGuid():N}"[..20], form = "drops", country = "BR", substances = new[] { new { substanceId = MedicationCatalogSeed.Paracetamol.Id } } }).Ok())
            .ReadAsync<JsonElement>()).GetProperty("id").GetGuid();
        var medicationId = Guid.NewGuid();
        await family.Owner.PutAsJsonAsync($"{BabyPath(family)}/medications/{medicationId}", new { name = "Movesol", productId, isUsual = false }).Ok();
        await family.Owner.PostAsync(Route(family, "/move-in"), null).Ok();
        Assert.Equal("moved", (await WaitForMoveAsync(family)).State);
        await factory.QueryAsync(async context =>
        {
            await context.ProductSubstances.Where(row => row.ProductId == productId).ExecuteDeleteAsync();
            return await context.Products.IgnoreQueryFilters().Where(row => row.Id == productId).ExecuteDeleteAsync();
        });

        await family.Owner.PostAsync(Route(family, "/move-out"), null).Ok();

        Assert.Equal("moved", (await WaitForMoveAsync(family)).State);
        Assert.Null(await factory.QueryAsync(context => context.Medications.Where(row => row.Id == medicationId).Select(row => row.ProductId).SingleAsync()));
        Assert.Equal(productId, await factory.Stores.QueryAsync(family.StoreId, context => context.Medications.Where(row => row.Id == medicationId).Select(row => row.ProductId).SingleAsync()));
    }

    [Theory]
    [InlineData(BabyRole.Parent)]
    [InlineData(BabyRole.Viewer)]
    [InlineData(BabyRole.Doctor)]
    public async Task MoveIn_BabyWithAnotherMember_Is409StoreOwnerOnly(BabyRole role)
    {
        var family = await FamilyAsync(withDoctorHistory: false, role);

        var response = await family.Owner.PostAsync(Route(family, "/move-in"), null);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "store_owner_only");
        Assert.Null((await StatusAsync(family)).Move);
    }

    [Fact]
    public async Task MoveIn_PendingInvite_Is409StoreOwnerOnly()
    {
        var family = await FamilyAsync(withDoctorHistory: false);
        await family.Owner.PostAsJsonAsync($"{BabyPath(family)}/invites", new { role = "Viewer" }).Ok();

        var response = await family.Owner.PostAsync(Route(family, "/move-in"), null);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "store_owner_only");
    }

    [Fact]
    public async Task MoveOut_HostedBaby_And_MoveIn_BabyAlreadyInItsOwnDatabase_Are409StoreMoveNotNeeded()
    {
        var family = await FamilyAsync(withDoctorHistory: false);

        var outOfHosted = await family.Owner.PostAsync(Route(family, "/move-out"), null);
        await family.Owner.PostAsync(Route(family, "/move-in"), null).Ok();
        await WaitForMoveAsync(family);
        var inAgain = await family.Owner.PostAsync(Route(family, "/move-in"), null);

        await outOfHosted.AssertProblemAsync(HttpStatusCode.Conflict, "store_move_not_needed");
        await inAgain.AssertProblemAsync(HttpStatusCode.Conflict, "store_move_not_needed");
    }

    [Fact]
    public async Task MoveIn_StoreThatIsNotReady_Is503AndStartsNothing()
    {
        var family = await FamilyAsync(withDoctorHistory: false, createStore: false);

        var response = await family.Owner.PostAsync(Route(family, "/move-in"), null);

        await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        Assert.Null((await StatusAsync(family)).Move);
    }

    [Fact]
    public async Task Move_LogLines_CarryNoIdAndNoContent()
    {
        var family = await FamilyAsync(withDoctorHistory: true);
        await family.Owner.PostAsync(Route(family, "/move-in"), null).Ok();
        await WaitForMoveAsync(family);
        await family.Owner.PostAsync(Route(family, "/move-out"), null).Ok();
        await WaitForMoveAsync(family);

        var moveLines = factory.Logs.Lines
            .Where(line => line.StartsWith(typeof(DataStoreMoveRunner).FullName!, StringComparison.Ordinal)
                || line.StartsWith(typeof(DataStoreMoves).FullName!, StringComparison.Ordinal)
                || line.StartsWith(typeof(StoreMoveWorker).FullName!, StringComparison.Ordinal))
            .ToArray();
        Assert.Contains(moveLines, line => line.Contains("Moved a baby's records", StringComparison.Ordinal));
        string[] secrets = [family.BabyId.ToString(), family.BabyId.ToString("N"), family.StoreId.ToString(), DoctorPrivateNote, "Offer 120 ml"];
        Assert.Empty(moveLines.Where(line => secrets.Any(secret => line.Contains(secret, StringComparison.OrdinalIgnoreCase))));
    }

    private static string BabyPath(Family family) => $"/api/v1/babies/{family.BabyId}";

    private static string Route(Family family, string suffix = "") => $"{BabyPath(family)}/data-store{suffix}";

    /// <summary>The hosted copy without the private notes of people other than the Owner (and their read marks).</summary>
    private static SortedDictionary<string, List<string>> WithoutForeignPrivateNotes(SortedDictionary<string, List<string>> hosted)
    {
        var copy = new SortedDictionary<string, List<string>>(hosted.ToDictionary(table => table.Key, table => table.Value.ToList()), StringComparer.Ordinal);
        Assert.Single(copy["baby_notes"], row => row.Contains(DoctorPrivateNote, StringComparison.Ordinal));
        copy["baby_notes"].RemoveAll(row => row.Contains(DoctorPrivateNote, StringComparison.Ordinal));
        return copy;
    }

    private StoreMoveWorker Worker() => factory.Services.GetServices<IHostedService>().OfType<StoreMoveWorker>().Single();

    private async Task<DataStoreStatusResponse> StatusAsync(Family family) =>
        await (await family.Owner.GetAsync(Route(family)).Ok()).ReadAsync<DataStoreStatusResponse>();

    /// <summary>Polls the status until the move is moved or failed.</summary>
    private async Task<DataStoreMoveStatus> WaitForMoveAsync(Family family)
    {
        var deadline = DateTimeOffset.UtcNow + MoveTimeout;
        while (true)
        {
            var move = (await StatusAsync(family)).Move;
            if (move is { State: "moved" or "failed" or "completed" })
            {
                return move;
            }

            Assert.True(DateTimeOffset.UtcNow < deadline, $"The move did not end: {move?.State}");
            await Task.Delay(TimeSpan.FromMilliseconds(100));
        }
    }

    private Task<(Guid? StoreId, int Epoch)> PointerAsync(Family family) =>
        factory.QueryAsync(async context => await context.BabyStoreAssignments.Where(row => row.BabyId == family.BabyId)
            .Select(row => new ValueTuple<Guid?, int>(row.DataStoreId, row.Epoch)).SingleAsync());

    /// <summary>
    /// An allowlisted Owner with the BYO consent, her baby, her saved store (also created as a SQLite store unless told otherwise) and a
    /// record in every data table: her own through the routes, and, with <paramref name="withDoctorHistory"/>, a doctor's notes (one
    /// private), proposals and consultation measurement and the Owner's read mark, the doctor then removed. Other members stay when
    /// <paramref name="memberRoles"/> names them.
    /// </summary>
    private async Task<Family> FamilyAsync(bool withDoctorHistory, params BabyRole[] memberRoles) => await FamilyAsync(withDoctorHistory, true, memberRoles);

    private async Task<Family> FamilyAsync(bool withDoctorHistory, bool createStore, params BabyRole[] memberRoles)
    {
        var subject = factory.TakeAllowedSubject();
        BabyRole[] roles = withDoctorHistory ? [.. memberRoles, BabyRole.Doctor] : memberRoles;
        var baby = await factory.SeedBabyOwnedByAsync(subject, roles.Distinct().ToArray());
        await factory.GrantByoConsentAsync(subject);
        var owner = factory.CreateClientFor(subject);
        var family = new Family(baby, owner, DataStore.FirstStoreIdOf(await factory.UserIdAsync(subject)));
        await owner.PutAsync(Route(family), StoreBody()).Ok();
        if (createStore)
        {
            factory.Stores.Create(family.StoreId);
        }

        await SeedFamilyRecordsAsync(family);
        if (withDoctorHistory)
        {
            await SeedDoctorHistoryAsync(family, removeDoctor: !memberRoles.Contains(BabyRole.Doctor));
        }

        return family;
    }

    private static JsonContent StoreBody() =>
        JsonContent.Create(new
        {
            providerLabel = "Example Cloud",
            app = new { host = "db.example.com", port = 6543, database = "lotties", username = "lotties_app", password = "app-secret-value" },
            migrator = new { host = "direct.example.com", port = 5432, username = "lotties_migrator", password = "migrator-secret-value" },
            tls = new { sslMode = "verify_full" },
        });

    private static async Task SeedFamilyRecordsAsync(Family family)
    {
        var path = BabyPath(family);
        var client = family.Owner;
        var customType = await (await client.PostAsJsonAsync(
            $"{path}/event-types",
            new { key = "pump", name = "Pump", icon = "water_drop", color = "#123456", hasDuration = false, fields = new[] { new { key = "amount_ml", label = "Amount", kind = "number", min = 0, unit = "ml" } } }).Ok())
            .ReadAsync<JsonElement>();
        var medicationId = Guid.NewGuid();
        await client.PutAsJsonAsync($"{path}/medications/{medicationId}", new { name = "Colidis", isUsual = true }).Ok();
        await client.PutAsJsonAsync(
            $"{path}/prescriptions/{Guid.NewGuid()}",
            new { medicationId, kind = "asNeeded", dose = new { amount = 2, unit = "drops" }, minIntervalMinutes = 480, maxDosesPer24h = 3, startDate = "2026-01-01", prescriber = "Dr. Ana" }).Ok();
        await client.PutAsJsonAsync($"{path}/formulas/{Guid.NewGuid()}", new { name = "Aptamil 2", brand = "Aptamil", stage = "2", isCurrent = true, archived = false }).Ok();
        var providerId = Guid.NewGuid();
        await client.PutAsJsonAsync($"{path}/care-providers/{providerId}", new { name = "Dr. Ana Lima", specialty = "pediatrician", phone = "+55 11 5555-0000" }).Ok();
        await client.PutAsJsonAsync(
            $"{path}/appointments/{Guid.NewGuid()}",
            new { title = "Pediatrician", type = "consultation", startsAt = DateTimeOffset.UtcNow.AddDays(40), durationMinutes = 30, providerId, status = "upcoming" }).Ok();
        await client.PutAsJsonAsync($"{path}/vaccinations/{Guid.NewGuid()}", new { vaccineKey = "bcg", doseId = "bcg-1", doseLabel = "Dose única", givenOn = "2026-01-05", network = "public" }).Ok();
        await client.PutAsJsonAsync($"{path}/measurements/{Guid.NewGuid()}", new { date = "2026-01-09", weightKg = 5.4m }).Ok();
        await client.PutAsJsonAsync($"{path}/events/{Guid.NewGuid()}", new { typeId = BuiltInEventTypes.FeedingId, startedAt = Start, payload = new { method = "breast", side = "left" } }).Ok();
        var deleted = Guid.NewGuid();
        await client.PutAsJsonAsync($"{path}/events/{deleted}", new { typeId = BuiltInEventTypes.BathId, startedAt = Start.AddHours(1), payload = new { } }).Ok();
        await client.DeleteAsync($"{path}/events/{deleted}").Ok();
        await client.PutAsJsonAsync($"{path}/events/{Guid.NewGuid()}", new { typeId = customType.GetProperty("id").GetGuid(), startedAt = Start.AddHours(2), payload = new { amount_ml = 80 } }).Ok();
    }

    /// <summary>A doctor who worked with the baby: a shared recommendation the Owner read, a private note, proposals, a measurement.</summary>
    private async Task SeedDoctorHistoryAsync(Family family, bool removeDoctor)
    {
        var path = BabyPath(family);
        var doctor = factory.CreateClientFor(family.Baby.SubjectOf(BabyRole.Doctor));
        await doctor.PutAsJsonAsync("/api/v1/me/professional-profile", new { displayName = "Dr. Ana Souza", specialty = "Pediatrics", shareDisplayName = true, shareRegistration = true }).Ok();
        var recommendation = Guid.NewGuid();
        await doctor.PutAsJsonAsync($"{path}/notes/{recommendation}", new { kind = "recommendation", visibility = "shared", body = "Offer 120 ml every 3 hours." }).Ok();
        await doctor.PutAsJsonAsync($"{path}/notes/{Guid.NewGuid()}", new { kind = "note", visibility = "private", body = DoctorPrivateNote }).Ok();
        await family.Owner.PutAsync($"{path}/notes/{recommendation}/read", null).Ok();
        await doctor.PutAsJsonAsync($"{path}/measurements/{Guid.NewGuid()}", new { date = "2026-01-08", weightKg = 5.3m }).Ok();
        var proposals = new[] { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() };
        foreach (var proposal in proposals)
        {
            await doctor.PutAsJsonAsync($"{path}/prescription-proposals/{proposal}", Proposal()).Ok();
        }

        await family.Owner.PostAsJsonAsync($"{path}/prescription-proposals/{proposals[1]}/accept", new { prescriptionId = Guid.NewGuid() }).Ok();
        await family.Owner.PostAsJsonAsync($"{path}/prescription-proposals/{proposals[2]}/decline", new { reason = "Already on it." }).Ok();
        if (removeDoctor)
        {
            await family.Owner.DeleteAsync($"{path}/members/{await factory.UserIdAsync(family.Baby.SubjectOf(BabyRole.Doctor))}").Ok();
        }
    }

    private static object Proposal() => new
    {
        medicationName = "Paracetamol drops",
        kind = "scheduled",
        dose = new { amount = 2, unit = "drops" },
        timesOfDay = new[] { "20:00", "08:00" },
        startDate = "2026-10-22",
        endDate = "2026-10-29",
        instructions = "Give after the morning feed.",
    };

    /// <summary>Many events written straight to the built-in database (the routes would take minutes for thousands).</summary>
    private async Task SeedEventsAsync(Family family, int count)
    {
        var ownerId = await factory.UserIdAsync(family.Baby.OwnerSubject);
        await factory.SeedAsync(context =>
        {
            for (var index = 0; index < count; index++)
            {
                var at = Start.AddMinutes(index * 7);
                context.Events.Add(Event.Create(Guid.NewGuid(), family.BabyId, BuiltInEventTypes.DiaperId, ownerId, at, null, EventPayload.From($$"""{"content":"{{(index % 2 == 0 ? "WET" : "DIRTY")}}"}"""), index % 50 == 0 ? $"note {index}" : null, at));
            }

            return Task.CompletedTask;
        });
    }

    private sealed record Family(SeededBaby Baby, HttpClient Owner, Guid StoreId)
    {
        public Guid BabyId => Baby.BabyId;
    }
}
