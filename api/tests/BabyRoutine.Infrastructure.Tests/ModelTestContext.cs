using BabyRoutine.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;

namespace BabyRoutine.Infrastructure.Tests;

/// <summary>Builds a context against a placeholder connection string; no test opens a connection.</summary>
internal static class ModelTestContext
{
    private const string PlaceholderConnectionString = "Host=localhost;Database=model_tests";

    public static BabyRoutineDbContext Create()
    {
        var options = new DbContextOptionsBuilder<BabyRoutineDbContext>()
            .UseBabyRoutineDatabase(PlaceholderConnectionString)
            .Options;
        return new BabyRoutineDbContext((DbContextOptions<BabyRoutineDbContext>)options);
    }

    public static IModel DesignTimeModel(this BabyRoutineDbContext context) =>
        context.GetService<IDesignTimeModel>().Model;

    public static IEntityType Entity<TEntity>(this BabyRoutineDbContext context) =>
        context.DesignTimeModel().FindEntityType(typeof(TEntity))
        ?? throw new InvalidOperationException($"{typeof(TEntity).Name} is not mapped.");
}
