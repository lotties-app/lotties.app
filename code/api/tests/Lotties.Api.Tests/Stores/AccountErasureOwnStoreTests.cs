using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Lotties.Api.Tests.Support;
using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.CareProviders;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Notes;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using Lotties.Domain.Stores;
using Lotties.Domain.Users;
using Lotties.Domain.Vaccinations;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores.Failures;
using Lotties.Infrastructure.Stores.Moves;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Lotties.Api.Tests.Stores;

/// <summary>
/// Account deletion and the family's own database (docs/design/47-bring-your-own-database.md section 9, task T10), on SQLite stores:
/// with <c>?wipeOwnDatabase=true</c> (opt-in) the erased babies' rows in the 12 data tables of her store are deleted before Lotties'
/// side goes (the store a baby points at, an old copy kept for a move's undo window and a failed move's leftovers); without it her
/// database is left as it is; in both cases Lotties' side is erased (baby, descriptor, move rows) and the store is forgotten. A store
/// that cannot be reached never blocks the erasure: the baby is reported as not wiped, and no log line or answer names the store, the
/// baby or the address. Another person's babies and database are never touched, a shared baby on an external store still fails closed,
/// and a running move refuses the deletion. <see cref="OwnStoreTables"/> is the data-plane half of <c>AccountErasureTests.Rules</c>.
/// </summary>
public sealed class AccountErasureOwnStoreTests : IClassFixture<StoresApiFactory>
{
    private const string MePath = "/api/v1/me";
    private const string WipePath = "/api/v1/me?wipeOwnDatabase=true";
    private const string FakeAddress = "203.0.113.77";

    private static readonly DateTimeOffset Now = new(2026, 11, 8, 10, 0, 0, TimeSpan.Zero);

    private readonly StoresApiFactory _factory;

    public AccountErasureOwnStoreTests(StoresApiFactory factory)
    {
        _factory = factory;
        _factory.Stores.FailureInterceptors = storeId => _factory.Services.GetRequiredService<StoreFailureInterceptors>().For(storeId);
    }

    /// <summary>
    /// What erasing a baby with the account does in the user's own database, per data table: every table goes when she asks for it
    /// (opt-in), nothing changes there otherwise. A new data table fails <see cref="OwnStoreTables_CoverEveryDataTable"/> until it is
    /// listed here (and in <c>DataPlaneTables</c>, which the wipe goes through).
    /// </summary>
    public static readonly IReadOnlySet<string> OwnStoreTables = new HashSet<string>(StringComparer.Ordinal)
    {
        "appointments", "baby_notes", "care_providers", "event_types", "events", "formulas", "measurements", "medications",
        "note_reads", "prescription_proposals", "prescriptions", "vaccinations",
    };

    [Fact]
    public void OwnStoreTables_CoverEveryDataTable()
    {
        Assert.Equal(OwnStoreTables.Order(StringComparer.Ordinal), DataPlaneTables.InCopyOrder.Select(table => table.Name).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task OptIn_BabyOnHerOwnStoreWithARowInEveryTable_WipesItThereAndErasesLottiesSide()
    {
        var owner = await OwnerWithStoreAsync();
        var babyId = await BabyOnStoreAsync(owner);
        await PutRecordsInStoreAsync(owner.StoreId, babyId, owner.UserId);
        await PutOldCopyInLottiesAsync(babyId, owner.UserId);
        Assert.All(await StoreSnapshotAsync(owner.StoreId, babyId), table => Assert.True(table.Value.Count > 0, $"{table.Key} has no row"));

        var result = await DeleteAsync(owner, WipePath);

        Assert.Equal([babyId], Ids(result, "ownDatabaseWiped"));
        Assert.Empty(Ids(result, "ownDatabaseNotWiped"));
        Assert.Equal(0, DataPlaneSnapshot.Count(await StoreSnapshotAsync(owner.StoreId, babyId)));
        await AssertLottiesSideErasedAsync(owner, babyId);
    }

    [Fact]
    public async Task OptOut_BabyOnHerOwnStore_LeavesHerDatabaseAsItIsAndErasesLottiesSide()
    {
        var owner = await OwnerWithStoreAsync();
        var babyId = await BabyOnStoreAsync(owner);
        await PutRecordsInStoreAsync(owner.StoreId, babyId, owner.UserId);
        await PutOldCopyInLottiesAsync(babyId, owner.UserId);
        var before = await StoreSnapshotAsync(owner.StoreId, babyId);

        var result = await DeleteAsync(owner, MePath);

        Assert.Empty(Ids(result, "ownDatabaseWiped"));
        Assert.Empty(Ids(result, "ownDatabaseNotWiped"));
        Assert.Equal(before, await StoreSnapshotAsync(owner.StoreId, babyId));
        await AssertLottiesSideErasedAsync(owner, babyId);
    }

    [Fact]
    public async Task OptIn_StoreUnreachable_ErasesLottiesSideAndReportsTheBabyNotWipedWithoutNamingIt()
    {
        var owner = await OwnerWithStoreAsync();
        var babyId = await BabyOnStoreAsync(owner);
        await PutRecordsInStoreAsync(owner.StoreId, babyId, owner.UserId);
        var before = await StoreSnapshotAsync(owner.StoreId, babyId);
        _factory.Stores.FaultsOf(owner.StoreId).ConnectionFault = new NpgsqlException($"Failed to connect to {FakeAddress}:5432", new SocketException((int)SocketError.ConnectionRefused));
        var logged = _factory.Logs.Lines.Count;

        var response = await _factory.CreateClientFor(owner.Subject).DeleteAsync(WipePath);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        var result = JsonDocument.Parse(body).RootElement;
        Assert.Equal([babyId], Ids(result, "ownDatabaseNotWiped"));
        Assert.Empty(Ids(result, "ownDatabaseWiped"));
        Assert.DoesNotContain(FakeAddress, body, StringComparison.Ordinal);
        Assert.DoesNotContain(owner.StoreId.ToString(), body, StringComparison.OrdinalIgnoreCase);
        _factory.Stores.FaultsOf(owner.StoreId).Clear();
        Assert.Equal(before, await StoreSnapshotAsync(owner.StoreId, babyId));
        await AssertLottiesSideErasedAsync(owner, babyId);
        // Lotties' own log lines (EF's lines about these SQLite test files are not what a production store logs: design 47 T8).
        var lines = _factory.Logs.Lines.Skip(logged).Where(line => line.StartsWith("Lotties.", StringComparison.Ordinal)).ToList();
        Assert.Contains(lines, line => line.Contains("1 not wiped", StringComparison.Ordinal));
        Assert.Empty(lines.Where(line => line.Contains(FakeAddress, StringComparison.Ordinal) || line.Contains(babyId.ToString(), StringComparison.OrdinalIgnoreCase)));

        // The breaker's lines name the store id and the failure class (design 47 T8); the deletion's own lines not even that.
        Assert.Empty(lines.Where(line => line.StartsWith("Lotties.Application.Users", StringComparison.Ordinal) && line.Contains(owner.StoreId.ToString(), StringComparison.OrdinalIgnoreCase)));
    }

    [Fact]
    public async Task OptIn_UndoWindowCopyAndFailedMoveLeftovers_AreWipedInHerStore()
    {
        var owner = await OwnerWithStoreAsync();
        var movedBack = await HostedBabyAsync(owner);
        var failedIn = await HostedBabyAsync(owner);
        await PutRecordsInStoreAsync(owner.StoreId, movedBack, owner.UserId);
        await PutRecordsInStoreAsync(owner.StoreId, failedIn, owner.UserId);
        await _factory.SeedAsync(context =>
        {
            context.DataStoreMoves.Add(MovedOut(movedBack, owner.StoreId));
            context.DataStoreMoves.Add(FailedInWithLeftovers(failedIn, owner.StoreId));
            return Task.CompletedTask;
        });

        var result = await DeleteAsync(owner, WipePath);

        Assert.Equal(new[] { failedIn, movedBack }.Order(), Ids(result, "ownDatabaseWiped").Order());
        Assert.Equal(0, DataPlaneSnapshot.Count(await StoreSnapshotAsync(owner.StoreId, movedBack)));
        Assert.Equal(0, DataPlaneSnapshot.Count(await StoreSnapshotAsync(owner.StoreId, failedIn)));
        Assert.False(await _factory.QueryAsync(context => context.DataStoreMoves.AnyAsync(move => move.BabyId == movedBack || move.BabyId == failedIn)));
    }

    [Fact]
    public async Task OptIn_OtherPeoplesBabiesAndDatabases_AreUntouched()
    {
        var other = await OwnerWithStoreAsync();
        var othersBaby = await BabyOnStoreAsync(other);
        await PutRecordsInStoreAsync(other.StoreId, othersBaby, other.UserId);
        var othersBefore = await StoreSnapshotAsync(other.StoreId, othersBaby);
        var owner = await OwnerWithStoreAsync();
        var babyId = await BabyOnStoreAsync(owner);
        await PutRecordsInStoreAsync(owner.StoreId, babyId, owner.UserId);
        var forged = await HostedBabyAsync(owner);
        await PutRecordsInStoreAsync(other.StoreId, forged, owner.UserId);
        var forgedBefore = await StoreSnapshotAsync(other.StoreId, forged);
        await _factory.SeedAsync(context =>
        {
            context.DataStoreMoves.Add(MovedOut(forged, other.StoreId));
            return Task.CompletedTask;
        });
        var (sharedBaby, parent) = await SharedBabyAsync(other);

        await DeleteAsync(owner, WipePath);
        var parentResult = await DeleteAsync(parent, WipePath);

        Assert.Equal(0, DataPlaneSnapshot.Count(await StoreSnapshotAsync(owner.StoreId, babyId)));
        Assert.Equal(othersBefore, await StoreSnapshotAsync(other.StoreId, othersBaby));
        Assert.Equal(forgedBefore, await StoreSnapshotAsync(other.StoreId, forged));
        Assert.True(await _factory.QueryAsync(context => context.Babies.AnyAsync(baby => baby.Id == othersBaby)));
        Assert.True(await _factory.QueryAsync(context => context.Babies.AnyAsync(baby => baby.Id == sharedBaby)));
        Assert.True(await _factory.QueryAsync(context => context.DataStores.AnyAsync(store => store.Id == other.StoreId)));
        Assert.Empty(Ids(parentResult, "ownDatabaseWiped"));
        Assert.Empty(Ids(parentResult, "ownDatabaseNotWiped"));
    }

    [Fact]
    public async Task Delete_MemberOfABabyOnAnExternalStoreThatOthersKeep_FailsClosedAndErasesNothing()
    {
        var other = await OwnerWithStoreAsync();
        var (sharedBaby, parent) = await SharedBabyAsync(other);
        await PointAtAsync(sharedBaby, other.StoreId);

        var response = await _factory.CreateClientFor(parent.Subject).DeleteAsync(WipePath);

        await response.AssertProblemAsync(HttpStatusCode.ServiceUnavailable, "store_unavailable");
        Assert.True(await _factory.QueryAsync(context => context.BabyMembers.AnyAsync(member => member.UserId == parent.UserId && member.BabyId == sharedBaby)));
        Assert.Null(await _factory.QueryAsync(context => context.Users.Where(user => user.Id == parent.UserId).Select(user => user.DeletedAt).SingleAsync()));
    }

    [Fact]
    public async Task Delete_WhileAMoveOfHerBabyRuns_Is409AndErasesNothing()
    {
        var owner = await OwnerWithStoreAsync();
        var babyId = await HostedBabyAsync(owner);
        await _factory.SeedAsync(context =>
        {
            context.DataStoreMoves.Add(DataStoreMove.Start(babyId, DataStoreMoveDirection.In, owner.StoreId, "elsewhere", DateTimeOffset.UtcNow, TimeSpan.FromMinutes(10)));
            return Task.CompletedTask;
        });

        var response = await _factory.CreateClientFor(owner.Subject).DeleteAsync(WipePath);

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "store_move_in_progress");
        Assert.True(await _factory.QueryAsync(context => context.Babies.AnyAsync(baby => baby.Id == babyId)));
        Assert.True(await _factory.QueryAsync(context => context.DataStores.AnyAsync(store => store.Id == owner.StoreId)));
    }

    [Fact]
    public async Task Preview_NamesOnlyTheErasedBabiesWithRecordsInHerOwnDatabase()
    {
        var owner = await OwnerWithStoreAsync();
        var onStore = await BabyOnStoreAsync(owner);
        var movedBack = await HostedBabyAsync(owner);
        var hosted = await HostedBabyAsync(owner);
        await _factory.SeedAsync(context =>
        {
            context.DataStoreMoves.Add(MovedOut(movedBack, owner.StoreId));
            return Task.CompletedTask;
        });

        var preview = await (await _factory.CreateClientFor(owner.Subject).GetAsync("/api/v1/me/deletion-preview")).ReadAsync<JsonElement>();

        Assert.Equal(new[] { onStore, movedBack, hosted }.Order(), preview.GetProperty("deletedBabies").EnumerateArray().Select(baby => baby.GetProperty("id").GetGuid()).Order());
        Assert.Equal(new[] { onStore, movedBack }.Order(), Ids(preview, "ownDatabaseBabies").Order());
    }

    private static IReadOnlyList<Guid> Ids(JsonElement body, string property) =>
        [.. body.GetProperty(property).EnumerateArray().Select(item => item.ValueKind == JsonValueKind.Object ? item.GetProperty("id").GetGuid() : item.GetGuid())];

    /// <summary>A move out of her store that switched back to Lotties: the old copy stays in her store for the undo window.</summary>
    private static DataStoreMove MovedOut(Guid babyId, Guid storeId)
    {
        var move = DataStoreMove.Start(babyId, DataStoreMoveDirection.Out, storeId, "earlier", Now.AddDays(-1), TimeSpan.FromMinutes(2));
        move.BeginVerify("earlier", Now.AddDays(-1), TimeSpan.FromMinutes(2));
        move.Complete("earlier", Now.AddDays(-1), TimeSpan.FromDays(7));
        return move;
    }

    /// <summary>A move into her store that failed with part of the copy still there.</summary>
    private static DataStoreMove FailedInWithLeftovers(Guid babyId, Guid storeId)
    {
        var move = DataStoreMove.Start(babyId, DataStoreMoveDirection.In, storeId, "earlier", Now.AddDays(-1), TimeSpan.FromMinutes(2));
        move.Fail("store_unavailable", leftoversPending: true, Now.AddDays(-1));
        return move;
    }

    private async Task<JsonElement> DeleteAsync(Owner owner, string path)
    {
        var response = await _factory.CreateClientFor(owner.Subject).DeleteAsync(path);
        Assert.True(response.StatusCode == HttpStatusCode.OK, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await response.ReadAsync<JsonElement>();
    }

    private async Task AssertLottiesSideErasedAsync(Owner owner, Guid babyId)
    {
        Assert.False(await _factory.QueryAsync(context => context.Babies.AnyAsync(baby => baby.Id == babyId)));
        Assert.False(await _factory.QueryAsync(context => context.DataStores.AnyAsync(store => store.OwnerUserId == owner.UserId)));
        Assert.False(await _factory.QueryAsync(context => context.DataStoreMoves.AnyAsync(move => move.BabyId == babyId)));
        Assert.Equal(0, DataPlaneSnapshot.Count(await _factory.QueryAsync(context => DataPlaneSnapshot.TakeAsync(context, babyId))));
        Assert.True(await _factory.QueryAsync(context => context.Users.Where(user => user.Id == owner.UserId).Select(user => user.DeletedAt != null).SingleAsync()));
        Assert.Contains(owner.StoreId, _factory.Health.Forgotten);
    }

    /// <summary>An account with her own store (a SQLite database and its <c>data_stores</c> row).</summary>
    private async Task<Owner> OwnerWithStoreAsync()
    {
        var subject = TestUsers.NewSubject();
        var user = User.Create(User.UnknownIssuer, subject, "Owner", TestUsers.Now);
        var storeId = _factory.Stores.Create();
        await _factory.SeedAsync(context =>
        {
            context.Users.Add(user);
            context.DataStores.Add(DataStore.Create(storeId, user.Id, TestUsers.Now));
            return Task.CompletedTask;
        });
        return new Owner(subject, user.Id, storeId);
    }

    private async Task<Guid> HostedBabyAsync(Owner owner)
    {
        var baby = Baby.Create("Lia", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), owner.UserId, TestUsers.Now);
        await _factory.SeedAsync(context =>
        {
            context.Babies.Add(baby);
            return Task.CompletedTask;
        });
        return baby.Id;
    }

    /// <summary>A baby of <paramref name="owner"/> that a Parent (another account, without a store) also uses.</summary>
    private async Task<(Guid BabyId, Owner Parent)> SharedBabyAsync(Owner owner)
    {
        var subject = TestUsers.NewSubject();
        var parent = User.Create(User.UnknownIssuer, subject, "Parent", TestUsers.Now);
        var baby = Baby.Create("Noah", DateOnly.FromDateTime(TestUsers.Now.UtcDateTime), owner.UserId, TestUsers.Now);
        baby.AddMember(parent.Id, BabyRole.Parent, TestUsers.Now);
        await _factory.SeedAsync(context =>
        {
            context.Users.Add(parent);
            context.Babies.Add(baby);
            return Task.CompletedTask;
        });
        return (baby.Id, new Owner(subject, parent.Id, Guid.Empty));
    }

    private async Task<Guid> BabyOnStoreAsync(Owner owner)
    {
        var babyId = await HostedBabyAsync(owner);
        await PointAtAsync(babyId, owner.StoreId);
        return babyId;
    }

    private Task PointAtAsync(Guid babyId, Guid storeId) =>
        _factory.SeedAsync(async context => (await context.BabyStoreAssignments.SingleAsync(row => row.BabyId == babyId)).MoveTo(DataStoreKey.External(storeId)));

    /// <summary>An event left in Lotties' database for the baby, like the old copy a move in keeps during its undo window.</summary>
    private Task PutOldCopyInLottiesAsync(Guid babyId, Guid ownerId) =>
        _factory.SeedAsync(context =>
        {
            context.Events.Add(Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.DiaperId, ownerId, Now, null, EventPayload.From("""{"content":"WET"}"""), null, Now));
            return Task.CompletedTask;
        });

    private Task<SortedDictionary<string, List<string>>> StoreSnapshotAsync(Guid storeId, Guid babyId) =>
        _factory.Stores.QueryAsync(storeId, context => DataPlaneSnapshot.TakeAsync(context, babyId));

    /// <summary>A row of the baby in each of the 12 data tables of the store (a former doctor's note, read mark and proposal included).</summary>
    private Task PutRecordsInStoreAsync(Guid storeId, Guid babyId, Guid ownerId) =>
        _factory.Stores.QueryAsync(storeId, async context =>
        {
            AddRecords(context, babyId, ownerId, Guid.NewGuid());
            return await context.SaveChangesAsync();
        });

    private static void AddRecords(LottiesDataDbContext context, Guid babyId, Guid ownerId, Guid doctorId)
    {
        var custom = EventType.CreateCustom(babyId, EventTypeKey.From("pump"), "Pump", "water_drop", HexColor.From("#123456"), false, []);
        context.EventTypes.Add(custom);
        context.Events.Add(Event.Create(Guid.NewGuid(), babyId, custom.Id, ownerId, Now, null, EventPayload.From("""{"amount_ml":80}"""), null, Now));
        var medication = Medication.Create(Guid.NewGuid(), babyId, "Colidis", Dosage.Create(2, "drops"), "after feeds", true, Now);
        context.Medications.Add(medication);
        var schedule = PrescriptionSchedule.Create(PrescriptionKind.Scheduled, TimesOfDay.Parse(["08:00", "20:00"]), null, null, null, null);
        var dose = DoseRule.Create(2, "drops", perKg: false, roundingStep: null);
        context.Prescriptions.Add(Prescription.Create(Guid.NewGuid(), babyId, PrescriptionTerms.Create(medication.Id, PrescriptionStatus.Active, dose, schedule, null, new DateOnly(2026, 10, 1), null, null, null), ownerId, Now));
        context.Formulas.Add(Formula.Create(Guid.NewGuid(), babyId, FormulaTerms.Create("Aptamil 2", "Aptamil", "2", null, null, true, false), ownerId, Now));
        var careProvider = CareProvider.Create(Guid.NewGuid(), babyId, CareProviderTerms.Create("Dr. Ana Lima", "pediatrician", null, null, null, null, null, "+55 11 5555-0000", null, null, null, null, true, false), ownerId, Now);
        context.CareProviders.Add(careProvider);
        context.Appointments.Add(Appointment.Create(Guid.NewGuid(), babyId, AppointmentTerms.Create("Pediatrician", AppointmentType.Consultation, Now.AddDays(10), 30, null, null, null, null, AppointmentStatus.Upcoming, AppointmentReminders.Default, careProvider.Id), ownerId, Now));
        context.Vaccinations.Add(Vaccination.Create(Guid.NewGuid(), babyId, VaccinationTerms.Create("bcg", "bcg-1", null, "Dose única", new DateOnly(2026, 8, 5), VaccineNetwork.Public, null, null, null, null), ownerId, Now));
        context.Measurements.Add(Measurement.Create(Guid.NewGuid(), babyId, new DateOnly(2026, 11, 1), 5.4m, 58.5m, null, null, ownerId, Now));
        var shared = BabyNote.Create(Guid.NewGuid(), babyId, NoteTerms.Create(NoteKind.Recommendation, NoteVisibility.Shared, "Offer 120 ml every 3 hours."), doctorId, Now);
        context.BabyNotes.Add(shared);
        context.NoteReads.Add(NoteRead.Of(shared, ownerId, Now));
        var proposalTerms = ProposalTerms.Create(MedicationReference.Create(null, null, "Paracetamol drops"), dose, schedule, null, new DateOnly(2026, 10, 22), new DateOnly(2026, 10, 29), "Give after the morning feed.", null);
        context.PrescriptionProposals.Add(PrescriptionProposal.Create(Guid.NewGuid(), babyId, proposalTerms, doctorId, Now));
    }

    private sealed record Owner(string Subject, Guid UserId, Guid StoreId);
}
