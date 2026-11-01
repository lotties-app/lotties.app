using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace BabyRoutine.Infrastructure.Persistence;

/// <summary>
/// Used by <c>dotnet ef</c>. Reads <c>DB_HOST</c>, <c>DB_PORT</c>, <c>DB_NAME</c> and the migrator credentials
/// <c>DB_MIGRATOR_USER</c>/<c>DB_MIGRATOR_PASSWORD</c> (falling back to <c>DB_APP_*</c>) from the environment.
/// </summary>
public sealed class BabyRoutineDbContextFactory : IDesignTimeDbContextFactory<BabyRoutineDbContext>
{
    public BabyRoutineDbContext CreateDbContext(string[] args)
    {
        var connectionString = DatabaseOptions.ForMigratorFromEnvironment().ToConnectionString();
        var options = new DbContextOptionsBuilder<BabyRoutineDbContext>().UseBabyRoutineDatabase(connectionString).Options;
        return new BabyRoutineDbContext((DbContextOptions<BabyRoutineDbContext>)options);
    }
}
