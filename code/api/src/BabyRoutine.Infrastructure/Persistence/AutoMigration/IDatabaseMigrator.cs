namespace BabyRoutine.Infrastructure.Persistence.AutoMigration;

/// <summary>Applies the pending EF Core migrations to the database, serialized across instances.</summary>
public interface IDatabaseMigrator
{
    Task MigrateAsync(CancellationToken cancellationToken = default);
}
