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
/// Today every baby's data lives in the built-in Lotties database, so this context is opened on the connection of the scope's
/// <see cref="LottiesDbContext"/> (one connection per request, as before the split; <see cref="BuiltInUnitOfWork"/> shares a
/// transaction when a write spans both planes). It has no migrations of its own yet: <see cref="LottiesDbContext"/> still maps
/// these tables with their physical foreign keys and owns every migration (the data migration chain is task T5). No repository
/// receives it directly: each gets the context of the baby's store from <see cref="Stores.StoreScope"/> (task T2).
/// </remarks>
public sealed class LottiesDataDbContext(DbContextOptions<LottiesDataDbContext> options) : DbContext(options)
{
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

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(LottiesDataDbContext).Assembly, DataPlane.IsDataConfiguration);
}
