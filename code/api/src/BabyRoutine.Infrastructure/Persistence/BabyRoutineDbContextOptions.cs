using Microsoft.EntityFrameworkCore;

namespace BabyRoutine.Infrastructure.Persistence;

/// <summary>The single place that configures the provider and naming conventions, shared by runtime, design time and tests.</summary>
public static class BabyRoutineDbContextOptions
{
    public static DbContextOptionsBuilder UseBabyRoutineDatabase(this DbContextOptionsBuilder builder, string connectionString)
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);
        return builder.UseNpgsql(connectionString).UseSnakeCaseNamingConvention();
    }
}
