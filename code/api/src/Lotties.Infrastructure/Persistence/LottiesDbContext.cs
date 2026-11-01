using Lotties.Domain.Babies;
using Lotties.Domain.Catalog;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Notifications;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence;

/// <summary>EF Core context for the Lotties PostgreSQL database.</summary>
public sealed class LottiesDbContext(DbContextOptions<LottiesDbContext> options) : DbContext(options)
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

    /// <summary>Prescriptions including soft-deleted ones (no query filter: delta sync must see deletions).</summary>
    public DbSet<Prescription> Prescriptions => Set<Prescription>();

    public DbSet<Substance> Substances => Set<Substance>();

    public DbSet<Product> Products => Set<Product>();

    public DbSet<ProductSubstance> ProductSubstances => Set<ProductSubstance>();

    /// <summary>Push subscriptions including revoked ones (revocation is soft).</summary>
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();

    public DbSet<UserNotificationSettings> UserNotificationSettings => Set<UserNotificationSettings>();

    public DbSet<BabyNotificationPreferences> BabyNotificationPreferences => Set<BabyNotificationPreferences>();

    public DbSet<NotificationDelivery> NotificationDeliveries => Set<NotificationDelivery>();

    public DbSet<NotificationAction> NotificationActions => Set<NotificationAction>();

    public DbSet<JobLease> JobLeases => Set<JobLease>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(LottiesDbContext).Assembly);
}
