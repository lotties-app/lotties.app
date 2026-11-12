using Lotties.Application;
using Lotties.Application.Users;
using Lotties.Domain.Users;
using Lotties.Infrastructure;
using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Lotties.Postgres.Tests.Support;

/// <summary>
/// A Lotties database of its own on the fixture's container, built by the control migration chain, with the API's own services
/// (<c>AddInfrastructure</c> + <c>AddApplication</c>, every baby on the built-in store). The only test seam is the signed-in account
/// of a scope (<see cref="Scope"/>). <see cref="NewContext"/> opens a bare <see cref="LottiesDbContext"/> on the same database, for
/// tests that need two independent units of work.
/// </summary>
internal sealed class BuiltInWorld : IAsyncDisposable
{
    private readonly ServiceProvider _provider;

    private BuiltInWorld(ServiceProvider provider, string connectionString, NpgsqlDataSource database)
    {
        _provider = provider;
        ConnectionString = connectionString;
        Database = database;
    }

    /// <summary>Superuser connection string to this world's Lotties database.</summary>
    public string ConnectionString { get; }

    /// <summary>Superuser data source on this world's Lotties database (raw SQL checks).</summary>
    public NpgsqlDataSource Database { get; }

    /// <summary>
    /// Creates the database and migrates it to <paramref name="targetMigration"/> (the latest when null); see
    /// <see cref="MigrateAsync"/> to continue later.
    /// </summary>
    public static async Task<BuiltInWorld> CreateAsync(PostgresFixture postgres, string prefix, string? targetMigration = null)
    {
        var name = PostgresFixture.UniqueName(prefix);
        var database = await postgres.CreateDatabaseAsync(name);
        var builder = new NpgsqlConnectionStringBuilder(postgres.ConnectionString) { Database = name };
        var services = new ServiceCollection()
            .AddInfrastructure(new DatabaseOptions(builder.Host!, builder.Port, name, builder.Username!, builder.Password!))
            .AddApplication();
        services.AddScoped<SignedIn>();
        services.AddScoped<ICurrentUser, SignedInUser>();
        var world = new BuiltInWorld(services.BuildServiceProvider(), builder.ConnectionString, database);
        await world.MigrateAsync(targetMigration);
        return world;
    }

    /// <summary>Applies the control chain up to <paramref name="targetMigration"/> (the latest when null).</summary>
    public async Task MigrateAsync(string? targetMigration = null)
    {
        await using var context = NewContext();
        if (targetMigration is null)
        {
            await context.Database.MigrateAsync();
            return;
        }

        await context.Database.MigrateAsync(targetMigration);
    }

    /// <summary>A bare context on this world's database; the caller disposes it.</summary>
    public LottiesDbContext NewContext() =>
        new((DbContextOptions<LottiesDbContext>)new DbContextOptionsBuilder<LottiesDbContext>().UseLottiesDatabase(ConnectionString).Options);

    /// <summary>A DI scope (one request's unit of work) signed in as <paramref name="userId"/>.</summary>
    public AsyncServiceScope Scope(Guid userId = default)
    {
        var scope = _provider.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<SignedIn>().UserId = userId;
        return scope;
    }

    public ValueTask DisposeAsync() => _provider.DisposeAsync();

    private sealed class SignedIn
    {
        public Guid UserId { get; set; }
    }

    private sealed class SignedInUser(SignedIn signedIn, LottiesDbContext context) : ICurrentUser
    {
        public bool IsAuthenticated => true;

        public Task<User> GetUserAsync(CancellationToken cancellationToken = default) =>
            context.Users.SingleAsync(user => user.Id == signedIn.UserId, cancellationToken);
    }
}
