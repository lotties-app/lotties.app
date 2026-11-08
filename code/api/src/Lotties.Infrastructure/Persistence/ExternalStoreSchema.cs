using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Infrastructure.Persistence;

/// <summary>
/// The shape of <see cref="LottiesDataDbContext"/> on an external store (docs/design/47-bring-your-own-database.md section 4): the
/// data tables in schema <see cref="Schema"/> (never <c>public</c>, which providers often expose through a REST API), the store's
/// own row <c>lotties.store_meta</c>, and the data migration chain's history table <c>lotties.__ef_data_migrations</c>. The
/// built-in store never uses these options: its data tables stay in <c>public</c>, migrated by the control chain.
/// </summary>
public static class ExternalStoreSchema
{
    /// <summary>The schema of every table Lotties creates in a family's database.</summary>
    public const string Schema = "lotties";

    /// <summary>The history table of the data migration chain, in <see cref="Schema"/>.</summary>
    public const string HistoryTable = "__ef_data_migrations";

    /// <summary>The store's own row.</summary>
    public const string MetaTable = "store_meta";

    /// <summary>Options of a data context on an external store, on a connection the caller owns (the migrator's or a request's).</summary>
    public static DbContextOptions<LottiesDataDbContext> Options(DbConnection connection)
    {
        ArgumentNullException.ThrowIfNull(connection);
        return Configure(new DbContextOptionsBuilder<LottiesDataDbContext>(), builder => builder.UseNpgsql(connection, Npgsql)).Options;
    }

    /// <summary>Same as <see cref="Options(DbConnection)"/> on a connection string (design time: <c>dotnet ef migrations add</c>).</summary>
    internal static DbContextOptions<LottiesDataDbContext> Options(string connectionString)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);
        return Configure(new DbContextOptionsBuilder<LottiesDataDbContext>(), builder => builder.UseNpgsql(connectionString, Npgsql)).Options;
    }

    /// <summary>Maps the external store's extras: the default schema and <c>store_meta</c>. Called by the context's model builder.</summary>
    internal static void Apply(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema(Schema);
        modelBuilder.Entity<StoreMetaRow>(StoreMetaRow.Configure);
    }

    private static DbContextOptionsBuilder<LottiesDataDbContext> Configure(
        DbContextOptionsBuilder<LottiesDataDbContext> builder,
        Action<DbContextOptionsBuilder<LottiesDataDbContext>> provider)
    {
        provider(builder);
        builder.UseSnakeCaseNamingConvention();
        builder.ReplaceService<IModelCacheKeyFactory, ExternalStoreModelCacheKeyFactory>();
        ((IDbContextOptionsBuilderInfrastructure)builder).AddOrUpdateExtension(new ExternalStoreSchemaExtension());
        return builder;
    }

    private static void Npgsql(Npgsql.EntityFrameworkCore.PostgreSQL.Infrastructure.NpgsqlDbContextOptionsBuilder options) =>
        options.MigrationsHistoryTable(HistoryTable, Schema);
}

/// <summary>Marks the options of a data context on an external store (no services of its own).</summary>
internal sealed class ExternalStoreSchemaExtension : IDbContextOptionsExtension
{
    public DbContextOptionsExtensionInfo Info => new ExtensionInfo(this);

    public void ApplyServices(IServiceCollection services)
    {
    }

    public void Validate(IDbContextOptions options)
    {
    }

    private sealed class ExtensionInfo(IDbContextOptionsExtension extension) : DbContextOptionsExtensionInfo(extension)
    {
        public override bool IsDatabaseProvider => false;

        public override string LogFragment => "ExternalStoreSchema ";

        public override int GetServiceProviderHashCode() => 0;

        public override bool ShouldUseSameServiceProvider(DbContextOptionsExtensionInfo other) => other is ExtensionInfo;

        public override void PopulateDebugInfo(IDictionary<string, string> debugInfo) =>
            debugInfo["Lotties:ExternalStoreSchema"] = "1";
    }
}

/// <summary>Keeps the external store's model (schema <c>lotties</c>, <c>store_meta</c>) apart from the built-in one in EF's model cache.</summary>
internal sealed class ExternalStoreModelCacheKeyFactory : IModelCacheKeyFactory
{
    public object Create(DbContext context, bool designTime) =>
        (context.GetType(), context is LottiesDataDbContext { IsExternalStore: true }, designTime);
}
