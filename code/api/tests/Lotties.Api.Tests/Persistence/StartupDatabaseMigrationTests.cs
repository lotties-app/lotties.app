using Lotties.Api.Tests.Support;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.AutoMigration;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Lotties.Api.Tests.Persistence;

public sealed class StartupDatabaseMigrationTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    private static readonly DatabaseMigrationSettings Off = new(false, DatabaseMigrationSettings.DefaultLockTimeout, DatabaseMigrationSettings.DefaultLockPollInterval);
    private static readonly DatabaseMigrationSettings On = Off with { AutoMigrate = true };

    [Fact]
    public async Task RunAsync_FlagOff_DoesNotMigrate()
    {
        var migrator = new RecordingMigrator();

        await Startup(Off, migrator, PostgresServices()).RunAsync();

        Assert.Equal(0, migrator.Runs);
    }

    [Fact]
    public async Task RunAsync_FlagOnWithPostgres_MigratesOnce()
    {
        var migrator = new RecordingMigrator();

        await Startup(On, migrator, PostgresServices()).RunAsync();

        Assert.Equal(1, migrator.Runs);
    }

    [Fact]
    public async Task RunAsync_FlagOnWithSqlite_SkipsMigration()
    {
        var migrator = new RecordingMigrator();

        await Startup(On, migrator, SqliteServices()).RunAsync();

        Assert.Equal(0, migrator.Runs);
    }

    [Fact]
    public async Task RunAsync_MigrationFails_Rethrows()
    {
        var migrator = new RecordingMigrator { Failure = new TimeoutException("lock busy") };

        var exception = await Assert.ThrowsAsync<TimeoutException>(() => Startup(On, migrator, PostgresServices()).RunAsync());

        Assert.Equal("lock busy", exception.Message);
    }

    [Fact]
    public async Task TestHost_AutoMigrateOn_IsWiredAndSkipsTheSqliteDatabase()
    {
        using var host = factory.WithWebHostBuilder(builder => builder.UseSetting(DatabaseMigrationSettings.AutoMigrateKey, "true"));

        var settings = host.Services.GetRequiredService<DatabaseMigrationSettings>();
        await host.Services.GetRequiredService<StartupDatabaseMigration>().RunAsync();

        Assert.True(settings.AutoMigrate);
    }

    private static StartupDatabaseMigration Startup(DatabaseMigrationSettings settings, IDatabaseMigrator migrator, ServiceProvider services) =>
        new(settings, migrator, services.GetRequiredService<IServiceScopeFactory>(), NullLogger<StartupDatabaseMigration>.Instance);

    private static ServiceProvider PostgresServices() => new ServiceCollection()
        .AddDbContext<LottiesDbContext>(options => options.UseLottiesDatabase("Host=localhost;Database=never_opened"))
        .BuildServiceProvider();

    private static ServiceProvider SqliteServices() => new ServiceCollection()
        .AddDbContext<LottiesDbContext>(options => options.UseSqlite("Data Source=:memory:"))
        .BuildServiceProvider();

    private sealed class RecordingMigrator : IDatabaseMigrator
    {
        public int Runs { get; private set; }

        public Exception? Failure { get; init; }

        public Task MigrateAsync(CancellationToken cancellationToken = default)
        {
            Runs++;
            return Failure is null ? Task.CompletedTask : Task.FromException(Failure);
        }
    }
}
