using Lotties.Domain.Appointments;
using Lotties.Domain.Babies;
using Lotties.Domain.CareProviders;
using Lotties.Domain.Catalog;
using Lotties.Domain.Events;
using Lotties.Domain.EventTypes;
using Lotties.Domain.Formulas;
using Lotties.Domain.Measurements;
using Lotties.Domain.Medications;
using Lotties.Domain.Notes;
using Lotties.Domain.Prescriptions;
using Lotties.Domain.Proposals;
using Lotties.Domain.Users;
using Lotties.Domain.Vaccinations;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence.Configurations;

/// <summary>
/// The foreign keys of the built-in database from the data tables to the control tables (<c>babies</c>, <c>users</c>,
/// <c>products</c>), declared only on <see cref="LottiesDbContext"/>, which owns the migrations of every table. The data model
/// (<see cref="LottiesDataDbContext"/>) does not declare them (docs/design/47-bring-your-own-database.md section 2.1), so a
/// database the family brings never needs them; the built-in database keeps them exactly as the migrations created them.
/// The indexes these keys used to get by convention (<c>created_by</c>, the author, decider and reader ids) are declared in the
/// data configurations, so both models describe the same indexes (<c>PlaneModelTests</c>).
/// </summary>
internal static class BuiltInDatabaseLinks
{
    public static void Apply(ModelBuilder modelBuilder)
    {
        ArgumentNullException.ThrowIfNull(modelBuilder);
        LinkBabyAndCreator<Event>(modelBuilder, item => item.BabyId, item => item.CreatedBy);
        LinkBabyAndCreator<Prescription>(modelBuilder, item => item.BabyId, item => item.CreatedBy);
        LinkBabyAndCreator<Formula>(modelBuilder, item => item.BabyId, item => item.CreatedBy);
        LinkBabyAndCreator<Appointment>(modelBuilder, item => item.BabyId, item => item.CreatedBy);
        LinkBabyAndCreator<CareProvider>(modelBuilder, item => item.BabyId, item => item.CreatedBy);
        LinkBabyAndCreator<Vaccination>(modelBuilder, item => item.BabyId, item => item.CreatedBy);
        LinkBabyAndCreator<Measurement>(modelBuilder, item => item.BabyId, item => item.CreatedBy);
        LinkBabyAndCreator<BabyNote>(modelBuilder, item => item.BabyId, item => item.AuthorUserId);
        LinkBabyAndCreator<NoteRead>(modelBuilder, item => item.BabyId, item => item.UserId);
        LinkBabyAndCreator<PrescriptionProposal>(modelBuilder, item => item.BabyId, item => item.AuthorUserId);
        modelBuilder.Entity<PrescriptionProposal>().HasOne<User>().WithMany().HasForeignKey(item => item.DecidedBy).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<EventType>().HasOne<Baby>().WithMany().HasForeignKey(item => item.BabyId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<Medication>().HasOne<Baby>().WithMany().HasForeignKey(item => item.BabyId).OnDelete(DeleteBehavior.Restrict);
        modelBuilder.Entity<Medication>().HasOne<Product>().WithMany().HasForeignKey(item => item.ProductId).OnDelete(DeleteBehavior.SetNull);
    }

    private static void LinkBabyAndCreator<TEntity>(
        ModelBuilder modelBuilder,
        System.Linq.Expressions.Expression<Func<TEntity, object?>> babyId,
        System.Linq.Expressions.Expression<Func<TEntity, object?>> userId)
        where TEntity : class
    {
        var entity = modelBuilder.Entity<TEntity>();
        entity.HasOne<Baby>().WithMany().HasForeignKey(babyId).OnDelete(DeleteBehavior.Restrict);
        entity.HasOne<User>().WithMany().HasForeignKey(userId).OnDelete(DeleteBehavior.Restrict);
    }
}
