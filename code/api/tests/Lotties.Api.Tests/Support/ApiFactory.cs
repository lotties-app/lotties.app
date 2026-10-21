using Lotties.Api.Configuration;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Persistence.Errors;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;

namespace Lotties.Api.Tests.Support;

/// <summary>
/// Hosts the real API in the <c>Testing</c> environment with a header-driven test authentication scheme and a
/// throw-away SQLite file database instead of PostgreSQL, so no Docker or real database is needed.
/// </summary>
/// <remarks>
/// The production EF model is used unchanged: <c>jsonb</c> column types are plain type names to SQLite and the
/// value converters already store JSON as text. Only timestamps (stored as UTC ticks so SQLite can filter and order
/// them) and the <c>xmin</c> row versions (a plain integer concurrency token) differ (<see cref="SqliteModelCustomizer"/>).
/// SQLite keeps the unique indexes, so user-creation races are real;
/// <see cref="SqliteUniqueViolationDetector"/> lets the repositories recognize them as PostgreSQL unique violations.
/// </remarks>
public sealed class ApiFactory : WebApplicationFactory<Program>
{
    private readonly string _databasePath = Path.Combine(Path.GetTempPath(), $"babyroutine-tests-{Guid.NewGuid():N}.db");

    private string ConnectionString => new SqliteConnectionStringBuilder
    {
        DataSource = _databasePath,
        Pooling = false,
        DefaultTimeout = 30,
    }.ToString();

    public async Task SeedAsync(Func<LottiesDbContext, Task> seed)
    {
        await using var scope = Services.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
        await seed(context);
        await context.SaveChangesAsync();
    }

    public async Task<TResult> QueryAsync<TResult>(Func<LottiesDbContext, Task<TResult>> query)
    {
        await using var scope = Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<LottiesDbContext>());
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(ApiEnvironments.Testing);
        builder.ConfigureTestServices(ReplaceDatabaseAndAuthentication);
    }

    protected override IHost CreateHost(IHostBuilder builder)
    {
        var host = base.CreateHost(builder);
        using var scope = host.Services.CreateScope();
        scope.ServiceProvider.GetRequiredService<LottiesDbContext>().Database.EnsureCreated();
        return host;
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        File.Delete(_databasePath);
    }

    private void ReplaceDatabaseAndAuthentication(IServiceCollection services)
    {
        services.RemoveAll<DbContextOptions<LottiesDbContext>>();
        services.RemoveAll<DbContextOptions>();
        services.AddDbContext<LottiesDbContext>(options => options
            .UseSqlite(ConnectionString)
            .UseSnakeCaseNamingConvention()
            .ReplaceService<IModelCustomizer, SqliteModelCustomizer>());
        services.AddSingleton<IUniqueViolationDetector, SqliteUniqueViolationDetector>();
        services.AddAuthentication().AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, null);
        services.PostConfigure<AuthenticationOptions>(UseTestSchemeByDefault);
        services.AddSingleton<IStartupFilter, ProbeEndpointsStartupFilter>();
    }

    private static void UseTestSchemeByDefault(AuthenticationOptions options)
    {
        options.DefaultScheme = TestAuthHandler.SchemeName;
        options.DefaultAuthenticateScheme = TestAuthHandler.SchemeName;
        options.DefaultChallengeScheme = TestAuthHandler.SchemeName;
        options.DefaultForbidScheme = TestAuthHandler.SchemeName;
    }
}
