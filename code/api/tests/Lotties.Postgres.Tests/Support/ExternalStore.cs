using Npgsql;

namespace Lotties.Postgres.Tests.Support;

/// <summary>
/// A second database playing a user's own ("external") store, set up like the BYO setup SQL of design 47 section 3:
/// a migrator role that owns schema <c>lotties</c>, an app role with DML on that schema only, and no rights on
/// <c>public</c>. Role names carry the store prefix because roles are cluster wide.
/// </summary>
public sealed class ExternalStore : IAsyncDisposable
{
    public const string Schema = "lotties";

    public ExternalStore(string database, string migratorRole, string appRole, string adminConnectionString,
        string migratorConnectionString, string appConnectionString)
    {
        Database = database;
        MigratorRole = migratorRole;
        AppRole = appRole;
        MigratorConnectionString = migratorConnectionString;
        AppConnectionString = appConnectionString;
        Admin = NpgsqlDataSource.Create(adminConnectionString);
        Migrator = NpgsqlDataSource.Create(migratorConnectionString);
        App = NpgsqlDataSource.Create(appConnectionString);
    }

    public string Database { get; }
    public string MigratorRole { get; }
    public string AppRole { get; }

    /// <summary>What a user would paste for the migrator role (with its password), as the router will receive it.</summary>
    public string MigratorConnectionString { get; }

    /// <summary>What a user would paste for the app role (with its password), as the router will receive it.</summary>
    public string AppConnectionString { get; }

    /// <summary>Superuser connection to this database (the provider's admin; Lotties never gets one).</summary>
    public NpgsqlDataSource Admin { get; }

    public NpgsqlDataSource Migrator { get; }
    public NpgsqlDataSource App { get; }

    public async ValueTask DisposeAsync()
    {
        await App.DisposeAsync();
        await Migrator.DisposeAsync();
        await Admin.DisposeAsync();
    }
}
