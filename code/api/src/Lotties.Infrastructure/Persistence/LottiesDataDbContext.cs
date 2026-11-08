using Lotties.Domain.Appointments;
using Lotties.Domain.CareProviders;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Notes;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using Lotties.Domain.Vaccinations;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence;

/// <summary>
/// EF Core context of the data plane (<see cref="DataPlane"/>; docs/design/47-bring-your-own-database.md section 2.1). Its model
/// declares no foreign key to a control table: <c>baby_id</c>, <c>created_by</c>, the author ids and <c>product_id</c> are plain
/// columns, checked by the services before a write. The keys inside the plane stay (<c>events.type_id</c>,
/// <c>note_reads.note_id</c>).
/// </summary>
/// <remarks>
/// Two shapes of the same model. On the built-in store (the Lotties database) the context is opened on the connection of the
/// scope's <see cref="LottiesDbContext"/> (one connection per request, as before the split; <see cref="BuiltInUnitOfWork"/> shares a
/// transaction when a write spans both planes), its tables are in <c>public</c> and <see cref="LottiesDbContext"/> still maps them
/// with their physical foreign keys and owns their migrations. On an external store (options from
/// <see cref="ExternalStoreSchema"/>) the same tables are in schema <c>lotties</c>, with <c>lotties.store_meta</c> beside them, and
/// the data migration chain (<c>Persistence/DataMigrations</c>, history table <c>lotties.__ef_data_migrations</c>) creates them; only
/// the store migrator (task T5) applies that chain, never to the built-in database. No repository receives this context
/// directly: each gets the context of the baby's store from <see cref="Stores.StoreScope"/> (task T2).
/// </remarks>
public sealed class LottiesDataDbContext(DbContextOptions<LottiesDataDbContext> options) : DbContext(options)
{
    /// <summary>Whether this context maps an external store (schema <c>lotties</c> and <c>store_meta</c>; <see cref="ExternalStoreSchema"/>).</summary>
    internal bool IsExternalStore { get; } = options.FindExtension<ExternalStoreSchemaExtension>() is not null;

    public DbSet<EventType> EventTypes => Set<EventType>();

    /// <summary>Events that are not soft deleted (a global query filter applies).</summary>
    public DbSet<Event> Events => Set<Event>();

    /// <summary>All events including soft-deleted ones; use for delta sync so clients learn about deletions.</summary>
    public IQueryable<Event> EventsIncludingDeleted => Events.IgnoreQueryFilters();

    public DbSet<Medication> Medications => Set<Medication>();

    public DbSet<Measurement> Measurements => Set<Measurement>();

    /// <summary>Prescriptions including soft-deleted ones (no query filter: delta sync must see deletions).</summary>
    public DbSet<Prescription> Prescriptions => Set<Prescription>();

    /// <summary>The babies' formulas, archived ones included (formulas are never deleted).</summary>
    public DbSet<Formula> Formulas => Set<Formula>();

    /// <summary>The babies' appointments, cancelled ones included (appointments are never deleted).</summary>
    public DbSet<Appointment> Appointments => Set<Appointment>();

    /// <summary>The babies' directories of care providers, soft-deleted ones included (clients learn deletes through the delta).</summary>
    public DbSet<CareProvider> CareProviders => Set<CareProvider>();

    /// <summary>The babies' recorded vaccines, soft-deleted ones included (readers of the schedule filter them).</summary>
    public DbSet<Vaccination> Vaccinations => Set<Vaccination>();

    /// <summary>The babies' notes including soft-deleted ones; readers filter by visibility (private notes: author only).</summary>
    public DbSet<BabyNote> BabyNotes => Set<BabyNote>();

    /// <summary>Prescriptions doctors suggested, decided ones included (never deleted); readers filter by visibility.</summary>
    public DbSet<PrescriptionProposal> PrescriptionProposals => Set<PrescriptionProposal>();

    /// <summary>Which member opened which note (the recommendations inbox).</summary>
    public DbSet<NoteRead> NoteReads => Set<NoteRead>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(LottiesDataDbContext).Assembly, DataPlane.IsDataConfiguration);
        if (IsExternalStore)
        {
            ExternalStoreSchema.Apply(modelBuilder);
        }
    }
}
