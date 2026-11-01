using System.Data.Common;
using Microsoft.EntityFrameworkCore;

namespace Lotties.Infrastructure.Persistence;

/// <summary>The single place that configures the provider and naming conventions, shared by runtime, design time and tests.</summary>
public static class LottiesDbContextOptions
{
    public static DbContextOptionsBuilder UseLottiesDatabase(this DbContextOptionsBuilder builder, string connectionString)
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);
        return builder.UseNpgsql(connectionString).UseSnakeCaseNamingConvention();
    }

    /// <summary>Same as the connection string overload, on an existing connection the caller owns (startup migrator).</summary>
    public static DbContextOptionsBuilder UseLottiesDatabase(this DbContextOptionsBuilder builder, DbConnection connection)
    {
        ArgumentNullException.ThrowIfNull(builder);
        ArgumentNullException.ThrowIfNull(connection);
        return builder.UseNpgsql(connection).UseSnakeCaseNamingConvention();
    }
}
