using BabyRoutine.Domain.Babies;
using BabyRoutine.Domain.Events;
using BabyRoutine.Domain.EventTypes;
using BabyRoutine.Domain.Measurements;
using BabyRoutine.Domain.Medications;
using BabyRoutine.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence;

/// <summary>EF Core context for the Baby Routine PostgreSQL database.</summary>
public sealed class BabyRoutineDbContext(DbContextOptions<BabyRoutineDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();

    public DbSet<Baby> Babies => Set<Baby>();

    public DbSet<BabyMember> BabyMembers => Set<BabyMember>();

    public DbSet<Invite> Invites => Set<Invite>();

    public DbSet<EventType> EventTypes => Set<EventType>();

    /// <summary>Events that are not soft deleted (a global query filter applies).</summary>
    public DbSet<Event> Events => Set<Event>();

    /// <summary>All events including soft-deleted ones; use for delta sync so clients learn about deletions.</summary>
    public IQueryable<Event> EventsIncludingDeleted => Events.IgnoreQueryFilters();

    public DbSet<Medication> Medications => Set<Medication>();

    public DbSet<Measurement> Measurements => Set<Measurement>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(BabyRoutineDbContext).Assembly);
}
