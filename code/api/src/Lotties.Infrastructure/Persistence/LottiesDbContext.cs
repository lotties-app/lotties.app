using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.Catalog;
using Lotties.Domain.CareProviders;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Notifications;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Users;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence;

/// <summary>
/// EF Core context of the control plane (accounts, babies, members, invites, doctor access, consents, push, settings, board,
/// catalog; docs/design/47-bring-your-own-database.md section 2.1) and the owner of the built-in database's schema.
/// </summary>
/// <remarks>
/// Its model is still the whole built-in database: it also maps the tables of <see cref="DataPlane"/> with their physical foreign
/// keys to <c>babies</c>, <c>users</c> and <c>products</c> (<see cref="Configurations.BuiltInDatabaseLinks"/>), so the migrations
/// and the snapshot are unchanged and keep owning every table until the data plane gets its own chain (task T5). Repositories read
/// and write the data tables through <see cref="LottiesDataDbContext"/>; the only code that reaches them through this context is
/// built-in-only and cross-plane on purpose (the reminder candidates query, account erasure), plus the test host's seeding.
/// </remarks>
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

    /// <summary>The babies' formulas, archived ones included (formulas are never deleted).</summary>
    public DbSet<Formula> Formulas => Set<Formula>();

    /// <summary>The babies' appointments, cancelled ones included (appointments are never deleted).</summary>
    public DbSet<Appointment> Appointments => Set<Appointment>();

    /// <summary>The babies' directories of care providers, soft-deleted ones included (clients learn deletes through the delta).</summary>
    public DbSet<CareProvider> CareProviders => Set<CareProvider>();

    /// <summary>The babies' recorded vaccines, soft-deleted ones included (readers of the schedule filter them).</summary>
    public DbSet<Lotties.Domain.Vaccinations.Vaccination> Vaccinations => Set<Lotties.Domain.Vaccinations.Vaccination>();

    /// <summary>Users' self-declared healthcare professional profiles (one per user).</summary>
    public DbSet<Lotties.Domain.Professionals.ProfessionalProfile> ProfessionalProfiles => Set<Lotties.Domain.Professionals.ProfessionalProfile>();

    /// <summary>The babies' notes including soft-deleted ones; readers filter by visibility (private notes: author only).</summary>
    public DbSet<Lotties.Domain.Notes.BabyNote> BabyNotes => Set<Lotties.Domain.Notes.BabyNote>();

    /// <summary>Recorded accesses of Doctors to the babies' data (append only).</summary>
    public DbSet<Lotties.Domain.AccessLogs.AccessLogEntry> AccessLog => Set<Lotties.Domain.AccessLogs.AccessLogEntry>();

    /// <summary>Prescriptions doctors suggested, decided ones included (never deleted); readers filter by visibility.</summary>
    public DbSet<Lotties.Domain.Proposals.PrescriptionProposal> PrescriptionProposals => Set<Lotties.Domain.Proposals.PrescriptionProposal>();

    /// <summary>Which member opened which note (the recommendations inbox).</summary>
    public DbSet<Lotties.Domain.Notes.NoteRead> NoteReads => Set<Lotties.Domain.Notes.NoteRead>();

    public DbSet<Substance> Substances => Set<Substance>();

    public DbSet<Product> Products => Set<Product>();

    public DbSet<ProductSubstance> ProductSubstances => Set<ProductSubstance>();

    /// <summary>Push subscriptions including revoked ones (revocation is soft).</summary>
    public DbSet<PushSubscription> PushSubscriptions => Set<PushSubscription>();

    /// <summary>App installs that want silent pushes for their widgets, including revoked ones (docs/design/37b-widget-silent-push.md).</summary>
    public DbSet<Lotties.Domain.SilentPush.SilentPushDevice> SilentPushDevices => Set<Lotties.Domain.SilentPush.SilentPushDevice>();

    public DbSet<UserNotificationSettings> UserNotificationSettings => Set<UserNotificationSettings>();

    public DbSet<BabyNotificationPreferences> BabyNotificationPreferences => Set<BabyNotificationPreferences>();

    public DbSet<NotificationDelivery> NotificationDeliveries => Set<NotificationDelivery>();

    public DbSet<NotificationAction> NotificationActions => Set<NotificationAction>();

    public DbSet<JobLease> JobLeases => Set<JobLease>();

    /// <summary>Users' voice assistant settings (one per user: the default baby).</summary>
    public DbSet<Lotties.Domain.Assistants.UserAssistantSettings> UserAssistantSettings => Set<Lotties.Domain.Assistants.UserAssistantSettings>();

    /// <summary>Users' measurement unit setting (one per user; docs/design/37-measurement-units.md).</summary>
    public DbSet<Lotties.Domain.Units.UserUnitSettings> UserUnitSettings => Set<Lotties.Domain.Units.UserUnitSettings>();

    public DbSet<Lotties.Domain.FeedingPreferences.UserFeedingSettings> UserFeedingSettings => Set<Lotties.Domain.FeedingPreferences.UserFeedingSettings>();

    /// <summary>People's caregiver rest settings (one per user; docs/design/41-caregiver-rest.md).</summary>
    public DbSet<Lotties.Domain.Rest.UserRestSettings> UserRestSettings => Set<Lotties.Domain.Rest.UserRestSettings>();

    /// <summary>The moment a person said she was up, one per user and night (docs/design/41-caregiver-rest.md R5).</summary>
    public DbSet<Lotties.Domain.Rest.UserRestMorning> UserRestMornings => Set<Lotties.Domain.Rest.UserRestMorning>();

    /// <summary>People's current consents, one per user and kind (docs/design/38-consent-and-terms.md).</summary>
    public DbSet<Lotties.Domain.Consents.UserConsent> UserConsents => Set<Lotties.Domain.Consents.UserConsent>();

    /// <summary>The append-only history of the consents (granted, withdrawn).</summary>
    public DbSet<Lotties.Domain.Consents.UserConsentHistoryEntry> UserConsentHistory => Set<Lotties.Domain.Consents.UserConsentHistoryEntry>();

    /// <summary>The append-only community insights consent history of each baby (docs/design/34-community-insights.md section 3.2; control plane).</summary>
    public DbSet<Lotties.Domain.CommunityInsights.CommunityConsentEntry> CommunityConsents => Set<Lotties.Domain.CommunityInsights.CommunityConsentEntry>();

    /// <summary>The project board's topics (docs/design/36-project-board.md; internal project tracking, never baby data).</summary>
    public DbSet<Lotties.Domain.Board.BoardTopic> BoardTopics => Set<Lotties.Domain.Board.BoardTopic>();

    /// <summary>The project board's items, soft-deleted ones included.</summary>
    public DbSet<Lotties.Domain.Board.BoardItem> BoardItems => Set<Lotties.Domain.Board.BoardItem>();

    /// <summary>The immutable history of the board items.</summary>
    public DbSet<Lotties.Domain.Board.BoardItemEvent> BoardItemEvents => Set<Lotties.Domain.Board.BoardItemEvent>();

    /// <summary>The board API keys (hashes only), revoked ones included.</summary>
    public DbSet<Lotties.Domain.Board.BoardApiKey> BoardApiKeys => Set<Lotties.Domain.Board.BoardApiKey>();

    /// <summary>The external data stores of bring-your-own-database (docs/design/47), by owner account; empty until task T6.</summary>
    public DbSet<Lotties.Domain.Stores.DataStore> DataStores => Set<Lotties.Domain.Stores.DataStore>();

    /// <summary>The routing columns of every baby row (<c>babies.data_store_id</c>, <c>babies.store_epoch</c>), read by the store resolver.</summary>
    public DbSet<Lotties.Domain.Stores.BabyStoreAssignment> BabyStoreAssignments => Set<Lotties.Domain.Stores.BabyStoreAssignment>();

    /// <summary>The latest move of each baby's records between the built-in store and the owner's store (task T7).</summary>
    public DbSet<Lotties.Domain.Stores.DataStoreMove> DataStoreMoves => Set<Lotties.Domain.Stores.DataStoreMove>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(LottiesDbContext).Assembly);
        Configurations.BuiltInDatabaseLinks.Apply(modelBuilder);
    }
}
