using System.Globalization;
using System.Reflection;
using Lotties.Application;
using Lotties.Application.Stores;
using Lotties.Application.Users;
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
using Lotties.Infrastructure;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores;
using Lotties.Postgres.Tests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Lotties.Postgres.Tests.Stores;

/// <summary>
/// A full move of a baby's records on real Postgres (design 47 section 6, task T7): a Lotties database built by the control migration
/// chain plays the built-in store, a second database with the BYO role set (migrated by the production store migrator) plays the
/// owner's store, and the production copier, runner and repositories move a baby with a row in every data table (owned dose and
/// schedule columns, jsonb payloads and fields, the proposals' <c>xmin</c>, soft deletions, thousands of events in batches) into the
/// store and back, value for value; a record id the store already gives another baby is refused as <c>store_move_conflict</c> with the
/// baby left where it was; deleting one baby's copy in a store leaves the others'. Account deletion (task T10) through the production
/// service: asked to, it deletes the moved baby's rows in the owner's store (and only them) before Lotties' side goes; not asked to,
/// her store is left as it is.
/// </summary>
[Collection(PostgresCollection.Name)]
[Trait("Category", PostgresCollection.Category)]
public sealed class StoreMovePostgresTests(PostgresFixture postgres)
{
    private static readonly DateTimeOffset Now = new(2026, 11, 8, 10, 0, 0, TimeSpan.Zero);

    private readonly StoreMigratorHarness _harness = new();

    [PostgresFact]
    public async Task Move_in_and_out_copies_every_table_as_stored_and_switches_both_ways()
    {
        await using var world = await WorldAsync("moveboth");
        var family = await world.SeedFamilyAsync(events: 2500);
        var hosted = await world.SnapshotAsync(DataStoreKey.BuiltIn, family.BabyId);
        Assert.All(hosted, table => Assert.True(table.Value.Count > 0, $"{table.Key} has no row"));

        var moved = await world.MoveAsync(family.BabyId, DataStoreMoveDirection.In);

        Assert.Equal(DataStoreMoveState.Moved, moved.State);
        Assert.Equal((world.StoreId, 1), await world.PointerAsync(family.BabyId));
        var own = await world.SnapshotAsync(world.Store, family.BabyId);
        Assert.Equal(Without(hosted, "baby_notes", family.ForeignPrivateNoteId), own);
        Assert.Equal(hosted, await world.SnapshotAsync(DataStoreKey.BuiltIn, family.BabyId));

        var back = await world.MoveAsync(family.BabyId, DataStoreMoveDirection.Out);

        Assert.Equal(DataStoreMoveState.Moved, back.State);
        Assert.Equal(((Guid?)null, 2), await world.PointerAsync(family.BabyId));
        Assert.Equal(own, await world.SnapshotAsync(DataStoreKey.BuiltIn, family.BabyId));
    }

    [PostgresFact]
    public async Task A_record_id_the_store_gives_another_baby_fails_the_move_and_leaves_the_baby_hosted()
    {
        await using var world = await WorldAsync("moveconflict");
        var family = await world.SeedFamilyAsync(events: 10);
        await world.EnsureStoreReadyAsync();
        var taken = await world.FirstEventIdAsync(family.BabyId);
        await world.InStoreAsync(async context =>
        {
            context.Events.Add(Event.Create(taken, Guid.NewGuid(), BuiltInEventTypes.DiaperId, Guid.NewGuid(), Now, null, EventPayload.From("""{"content":"WET"}"""), null, Now));
            await context.SaveChangesAsync();
        });

        var failed = await world.MoveAsync(family.BabyId, DataStoreMoveDirection.In);

        Assert.Equal((DataStoreMoveState.Failed, "store_move_conflict", false), (failed.State, failed.FailureCode, failed.LeftoversPending));
        Assert.Equal(((Guid?)null, 0), await world.PointerAsync(family.BabyId));
        Assert.Equal(0, Count(await world.SnapshotAsync(world.Store, family.BabyId)));
        Assert.Equal(1, await world.InStoreAsync(context => context.Events.IgnoreQueryFilters().CountAsync(row => row.Id == taken)));
    }

    [PostgresFact]
    public async Task Wiping_one_babys_copy_in_a_store_leaves_the_other_babies_rows()
    {
        await using var world = await WorldAsync("movewipe");
        var first = await world.SeedFamilyAsync(events: 20);
        var second = await world.SeedFamilyAsync(events: 30, ownerId: first.OwnerId);
        await world.MoveAsync(first.BabyId, DataStoreMoveDirection.In);
        await world.MoveAsync(second.BabyId, DataStoreMoveDirection.In);
        var secondBefore = await world.SnapshotAsync(world.Store, second.BabyId);

        await world.WipeAsync(first.BabyId, world.Store);

        Assert.Equal(0, Count(await world.SnapshotAsync(world.Store, first.BabyId)));
        Assert.Equal(secondBefore, await world.SnapshotAsync(world.Store, second.BabyId));
        Assert.True(Count(secondBefore) > 30);
    }

    [PostgresFact]
    public async Task Account_deletion_asked_to_wipe_deletes_the_babys_rows_in_the_owners_store_and_lotties_side()
    {
        await using var world = await WorldAsync("erasewipe");
        var family = await world.SeedFamilyAsync(events: 40);
        await world.MoveAsync(family.BabyId, DataStoreMoveDirection.In);
        Assert.All(await world.SnapshotAsync(world.Store, family.BabyId), table => Assert.True(table.Value.Count > 0, $"{table.Key} has no row"));
        var strangerEvent = Guid.NewGuid();
        await world.InStoreAsync(async context =>
        {
            context.Events.Add(Event.Create(strangerEvent, Guid.NewGuid(), BuiltInEventTypes.DiaperId, Guid.NewGuid(), Now, null, EventPayload.From("""{"content":"WET"}"""), null, Now));
            await context.SaveChangesAsync();
        });

        var result = await world.DeleteAccountAsync(family.OwnerId, wipeOwnDatabase: true);

        Assert.Equal([family.BabyId], result.OwnDatabaseWiped);
        Assert.Empty(result.OwnDatabaseNotWiped);
        Assert.Equal(0, Count(await world.SnapshotAsync(world.Store, family.BabyId)));
        Assert.Equal(1, await world.InStoreAsync(context => context.Events.IgnoreQueryFilters().CountAsync(row => row.Id == strangerEvent)));
        Assert.Equal(0, Count(await world.SnapshotAsync(DataStoreKey.BuiltIn, family.BabyId)));
        Assert.False(await world.ControlAsync(context => context.Babies.AnyAsync(baby => baby.Id == family.BabyId)));
        Assert.False(await world.ControlAsync(context => context.DataStores.AnyAsync(store => store.Id == world.StoreId)));
        Assert.False(await world.ControlAsync(context => context.DataStoreMoves.AnyAsync(move => move.BabyId == family.BabyId)));
    }

    [PostgresFact]
    public async Task Account_deletion_not_asked_to_wipe_leaves_the_owners_store_as_it_is()
    {
        await using var world = await WorldAsync("erasekeep");
        var family = await world.SeedFamilyAsync(events: 40);
        await world.MoveAsync(family.BabyId, DataStoreMoveDirection.In);
        var own = await world.SnapshotAsync(world.Store, family.BabyId);

        var result = await world.DeleteAccountAsync(family.OwnerId, wipeOwnDatabase: false);

        Assert.Empty(result.OwnDatabaseWiped);
        Assert.Equal(own, await world.SnapshotAsync(world.Store, family.BabyId));
        Assert.False(await world.ControlAsync(context => context.Babies.AnyAsync(baby => baby.Id == family.BabyId)));
        Assert.False(await world.ControlAsync(context => context.DataStores.AnyAsync(store => store.Id == world.StoreId)));
    }

    private static int Count(SortedDictionary<string, List<string>> snapshot) => snapshot.Values.Sum(rows => rows.Count);

    private static SortedDictionary<string, List<string>> Without(SortedDictionary<string, List<string>> snapshot, string table, Guid id)
    {
        var copy = new SortedDictionary<string, List<string>>(snapshot.ToDictionary(pair => pair.Key, pair => pair.Value.ToList()), StringComparer.Ordinal);
        Assert.Equal(1, copy[table].RemoveAll(row => row.Contains($"Id={id}", StringComparison.Ordinal)));
        return copy;
    }

    private async Task<MoveWorld> WorldAsync(string prefix)
    {
        var name = PostgresFixture.UniqueName(prefix);
        await postgres.CreateDatabaseAsync(name);
        var builder = new NpgsqlConnectionStringBuilder(postgres.ConnectionString) { Database = name };
        var store = await postgres.CreateExternalStoreAsync(prefix);
        var storeId = _harness.Register(store);
        var externals = new FixtureExternalStores(storeId, store.AppConnectionString);
        var services = new ServiceCollection()
            .AddInfrastructure(new DatabaseOptions(builder.Host!, builder.Port, name, builder.Username!, builder.Password!))
            .AddApplication();
        services.AddSingleton<IExternalDataStores>(externals);
        services.AddSingleton<IStoreMigrator>(_harness.Migrator());
        services.AddSingleton<SignedIn>();
        services.AddScoped<ICurrentUser, FixtureCurrentUser>();
        services.AddSingleton<IIdentityAccountRemover, NoIdentityRemover>();
        services.Configure<StoreRoutingOptions>(options => options.Enabled = true);
        services.Configure<StoreMoveOptions>(options =>
        {
            options.DrainSeconds = 0;
            options.BatchSize = 300;
        });
        var provider = services.BuildServiceProvider();
        await using (var scope = provider.CreateAsyncScope())
        {
            await scope.ServiceProvider.GetRequiredService<LottiesDbContext>().Database.MigrateAsync();
        }

        return new MoveWorld(provider, storeId);
    }

    /// <summary>The external stores of the test: the one store, on the fixture's app role (no egress guard: the container is on loopback).</summary>
    private sealed class FixtureExternalStores(Guid storeId, string appConnectionString) : IExternalDataStores
    {
        public ValueTask<IDataStore?> FindAsync(Guid id, CancellationToken cancellationToken = default) =>
            ValueTask.FromResult<IDataStore?>(id == storeId ? new FixtureStore(DataStoreKey.External(storeId), appConnectionString) : null);
    }

    private sealed class FixtureStore(DataStoreKey key, string connectionString) : IDataStore
    {
        public DataStoreKey Key => key;

        public LottiesDataDbContext CreateContext() => new(ExternalStoreSchema.Options(connectionString));
    }

    private sealed record Family(Guid BabyId, Guid OwnerId, Guid ForeignPrivateNoteId);

    /// <summary>Who the account deletion runs for.</summary>
    private sealed class SignedIn
    {
        public Guid UserId { get; set; }
    }

    private sealed class FixtureCurrentUser(SignedIn signedIn, LottiesDbContext context) : ICurrentUser
    {
        public bool IsAuthenticated => true;

        public Task<User> GetUserAsync(CancellationToken cancellationToken = default) =>
            context.Users.SingleAsync(user => user.Id == signedIn.UserId, cancellationToken);
    }

    private sealed class NoIdentityRemover : IIdentityAccountRemover
    {
        public bool CanRemove(string issuer) => false;

        public Task<IdentityRemoval> RemoveAsync(string issuer, string subject, CancellationToken cancellationToken = default) =>
            Task.FromResult(IdentityRemoval.NotConfigured);
    }

    private sealed class MoveWorld(ServiceProvider provider, Guid storeId) : IAsyncDisposable
    {
        public Guid StoreId => storeId;

        public DataStoreKey Store => DataStoreKey.External(storeId);

        public ValueTask DisposeAsync() => provider.DisposeAsync();

        public async Task EnsureStoreReadyAsync() => await provider.GetRequiredService<IStoreMigrator>().EnsureReadyAsync(storeId);

        /// <summary>
        /// An owner (and the owner's store row, once), a former doctor and a baby with a row in each of the 12 data tables: a custom type
        /// and its event, <paramref name="events"/> diaper events (one soft-deleted), a medication with a default dosage, a prescription,
        /// a formula, a care provider and its appointment, a vaccination, a measurement, the doctor's shared recommendation the owner
        /// read and her private note, and her proposal.
        /// </summary>
        public async Task<Family> SeedFamilyAsync(int events, Guid? ownerId = null)
        {
            await using var scope = provider.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
            var owner = ownerId is { } existing ? await context.Users.SingleAsync(user => user.Id == existing) : AddUser(context, "Owner");
            var doctor = AddUser(context, "Doctor");
            if (ownerId is null)
            {
                context.DataStores.Add(DataStore.Create(storeId, owner.Id, Now));
            }

            var baby = Baby.Create("Lia", new DateOnly(2026, 8, 1), owner.Id, Now);
            context.Babies.Add(baby);
            await context.SaveChangesAsync();
            var foreignNote = AddRecords(context, baby.Id, owner.Id, doctor.Id, events);
            await context.SaveChangesAsync();
            return new Family(baby.Id, owner.Id, foreignNote);
        }

        /// <summary>Starts a move as the owner's request would and runs it to its end in another scope, as the worker does.</summary>
        public async Task<DataStoreMove> MoveAsync(Guid babyId, DataStoreMoveDirection direction)
        {
            await using (var scope = provider.CreateAsyncScope())
            {
                var moves = scope.ServiceProvider.GetRequiredService<IDataStoreMoveRepository>();
                var holder = scope.ServiceProvider.GetRequiredService<StoreMoveWorkerId>().Value;
                var lease = scope.ServiceProvider.GetRequiredService<StoreMoveOptions>().Lease;
                var move = await moves.FindAsync(babyId);
                if (move is null)
                {
                    moves.Add(DataStoreMove.Start(babyId, direction, storeId, holder, DateTimeOffset.UtcNow, lease));
                }
                else
                {
                    move.Restart(direction, storeId, holder, DateTimeOffset.UtcNow, lease);
                }

                Assert.True(await moves.TrySaveAsync());
            }

            await using (var scope = provider.CreateAsyncScope())
            {
                await scope.ServiceProvider.GetRequiredService<IDataStoreMoveRunner>().RunStartedAsync(babyId);
            }

            await using var read = provider.CreateAsyncScope();
            return (await read.ServiceProvider.GetRequiredService<IDataStoreMoveRepository>().FindAsync(babyId))!;
        }

        /// <summary>Deletes the owner's account through the production service, as <c>DELETE /me</c> does.</summary>
        public async Task<AccountDeletionResponse> DeleteAccountAsync(Guid ownerId, bool wipeOwnDatabase)
        {
            provider.GetRequiredService<SignedIn>().UserId = ownerId;
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IAccountDeletionService>().DeleteAsync(new AccountDeletionRequest { WipeOwnDatabase = wipeOwnDatabase });
        }

        public async Task<TResult> ControlAsync<TResult>(Func<LottiesDbContext, Task<TResult>> query)
        {
            await using var scope = provider.CreateAsyncScope();
            return await query(scope.ServiceProvider.GetRequiredService<LottiesDbContext>());
        }

        public async Task WipeAsync(Guid babyId, DataStoreKey store)
        {
            await using var scope = provider.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IStoreRecordCopier>().WipeAsync(babyId, store);
        }

        public async Task<(Guid? Store, int Epoch)> PointerAsync(Guid babyId)
        {
            await using var scope = provider.CreateAsyncScope();
            var assignment = await scope.ServiceProvider.GetRequiredService<LottiesDbContext>().BabyStoreAssignments.AsNoTracking().SingleAsync(row => row.BabyId == babyId);
            return (assignment.DataStoreId, assignment.Epoch);
        }

        public async Task<Guid> FirstEventIdAsync(Guid babyId)
        {
            await using var scope = provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<LottiesDbContext>().Events.IgnoreQueryFilters()
                .Where(row => row.BabyId == babyId).OrderBy(row => row.Id).Select(row => row.Id).FirstAsync();
        }

        public async Task<TResult> InStoreAsync<TResult>(Func<LottiesDataDbContext, Task<TResult>> work)
        {
            await using var scope = provider.CreateAsyncScope();
            return await work(await scope.ServiceProvider.GetRequiredService<StoreScope>().OpenStoreAsync(Store));
        }

        public Task InStoreAsync(Func<LottiesDataDbContext, Task> work) =>
            InStoreAsync(async context =>
            {
                await work(context);
                return true;
            });

        /// <summary>Every row of the baby in the 12 data tables of <paramref name="store"/>, each as its stored values in name order.</summary>
        public async Task<SortedDictionary<string, List<string>>> SnapshotAsync(DataStoreKey store, Guid babyId)
        {
            await using var scope = provider.CreateAsyncScope();
            var context = await scope.ServiceProvider.GetRequiredService<StoreScope>().OpenStoreAsync(store);
            var tables = new SortedDictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (var type in DataPlane.EntityTypes)
            {
                var rows = await RowsAsync(context, type);
                tables[context.Model.FindEntityType(type)!.GetTableName()!] = rows
                    .Select(row => context.Entry(row))
                    .Where(entry => Equals(entry.Property("BabyId").CurrentValue, babyId))
                    .Select(Canonical)
                    .Order(StringComparer.Ordinal)
                    .ToList();
            }

            return tables;
        }

        private static User AddUser(LottiesDbContext context, string name)
        {
            var user = User.Create(User.UnknownIssuer, $"move|{Guid.NewGuid():N}", name, Now);
            context.Users.Add(user);
            return user;
        }

        private static Guid AddRecords(LottiesDbContext context, Guid babyId, Guid ownerId, Guid doctorId, int events)
        {
            var custom = EventType.CreateCustom(babyId, EventTypeKey.From("pump"), "Pump", "water_drop", HexColor.From("#123456"), false, []);
            context.EventTypes.Add(custom);
            for (var index = 0; index < events; index++)
            {
                var at = Now.AddMinutes(-7 * (index + 1));
                var diaper = Event.Create(Guid.NewGuid(), babyId, BuiltInEventTypes.DiaperId, ownerId, at, null, EventPayload.From(index % 2 == 0 ? """{"content":"WET"}""" : """{"content":"DIRTY"}"""), index % 40 == 0 ? $"note {index}" : null, at);
                if (index == 1)
                {
                    diaper.SoftDelete(Now);
                }

                context.Events.Add(diaper);
            }

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
            var foreign = BabyNote.Create(Guid.NewGuid(), babyId, NoteTerms.Create(NoteKind.Note, NoteVisibility.Private, "Doctor-only note."), doctorId, Now);
            context.BabyNotes.AddRange(shared, foreign);
            context.NoteReads.Add(NoteRead.Of(shared, ownerId, Now));
            var proposalTerms = ProposalTerms.Create(MedicationReference.Create(null, null, "Paracetamol drops"), dose, schedule, null, new DateOnly(2026, 10, 22), new DateOnly(2026, 10, 29), "Give after the morning feed.", null);
            context.PrescriptionProposals.Add(PrescriptionProposal.Create(Guid.NewGuid(), babyId, proposalTerms, doctorId, Now));
            return foreign.Id;
        }

        private static Task<List<object>> RowsAsync(DbContext context, Type type) =>
            (Task<List<object>>)typeof(MoveWorld).GetMethod(nameof(RowsOfAsync), BindingFlags.NonPublic | BindingFlags.Static)!
                .MakeGenericMethod(type)
                .Invoke(null, [context])!;

        private static async Task<List<object>> RowsOfAsync<TEntity>(DbContext context)
            where TEntity : class =>
            [.. await context.Set<TEntity>().IgnoreQueryFilters().AsTracking().ToListAsync()];

        private static string Canonical(EntityEntry entry) => string.Join(" | ", Values(entry).Order(StringComparer.Ordinal));

        private static IEnumerable<string> Values(EntityEntry entry) =>
            entry.Properties.Where(property => property.Metadata.Name != "Version").Select(property => $"{property.Metadata.Name}={Stored(property)}")
                .Concat(entry.References
                    .Where(reference => reference.Metadata.TargetEntityType.IsOwned() && reference.TargetEntry is not null)
                    .SelectMany(reference => Values(reference.TargetEntry!).Select(value => $"{reference.Metadata.Name}.{value}")));

        private static string Stored(PropertyEntry property)
        {
            var converter = property.Metadata.GetTypeMapping().Converter;
            var value = property.CurrentValue is { } current && converter is not null ? converter.ConvertToProvider(current) : property.CurrentValue;
            return value switch
            {
                null => "null",
                DateTimeOffset at => at.UtcTicks.ToString(CultureInfo.InvariantCulture),
                IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
                _ => value.ToString() ?? "null",
            };
        }
    }
}
