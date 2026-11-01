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

    public static IModel DesignTimeModel(this LottiesDbContext context) =>
        context.GetService<IDesignTimeModel>().Model;

    public static IEntityType Entity<TEntity>(this LottiesDbContext context) =>
        context.DesignTimeModel().FindEntityType(typeof(TEntity))
        ?? throw new InvalidOperationException($"{typeof(TEntity).Name} is not mapped.");
}
