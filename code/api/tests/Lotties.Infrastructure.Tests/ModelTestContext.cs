using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Lotties.Infrastructure.Tests;

/// <summary>Builds a context against a placeholder connection string; no test opens a connection.</summary>
internal static class ModelTestContext
{
    private const string PlaceholderConnectionString = "Host=localhost;Database=model_tests";

    public static LottiesDbContext Create()
    {
        var options = new DbContextOptionsBuilder<LottiesDbContext>()
            .UseLottiesDatabase(PlaceholderConnectionString)
            .Options;
        return new LottiesDbContext((DbContextOptions<LottiesDbContext>)options);
    }

    /// <summary>The data plane's context, on the same placeholder connection string.</summary>
    public static LottiesDataDbContext CreateData()
    {
        var options = new DbContextOptionsBuilder<LottiesDataDbContext>()
            .UseLottiesDatabase(PlaceholderConnectionString)
            .Options;
        return new LottiesDataDbContext((DbContextOptions<LottiesDataDbContext>)options);
    }

    public static IModel DesignTimeModel(this DbContext context) =>
        context.GetService<IDesignTimeModel>().Model;

    public static IEntityType Entity<TEntity>(this LottiesDbContext context) =>
        context.DesignTimeModel().FindEntityType(typeof(TEntity))
        ?? throw new InvalidOperationException($"{typeof(TEntity).Name} is not mapped.");
}
