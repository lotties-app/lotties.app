using Microsoft.EntityFrameworkCore.Design;

namespace Lotties.Infrastructure.Persistence;

/// <summary>
/// Used by <c>dotnet ef ... --context LottiesDataDbContext</c> to generate the data migration chain (external stores only,
/// <see cref="ExternalStoreSchema"/>). It never reads <c>DB_*</c>: its connection names a host under <c>.invalid</c>, a name that
/// never resolves (RFC 2606), so <c>dotnet ef database update --context LottiesDataDbContext</c> cannot reach the Lotties database
/// or any other. The data chain is applied only by the store migrator, to a family's database.
/// </summary>
public sealed class LottiesDataDbContextFactory : IDesignTimeDbContextFactory<LottiesDataDbContext>
{
    /// <summary>The host of the design-time connection: never a real database.</summary>
    public const string DesignTimeHost = "design-time.lotties-store.invalid";

    public LottiesDataDbContext CreateDbContext(string[] args) =>
        new(ExternalStoreSchema.Options($"Host={DesignTimeHost};Database=lotties_store;Username=design_time;Password=design_time"));
}
