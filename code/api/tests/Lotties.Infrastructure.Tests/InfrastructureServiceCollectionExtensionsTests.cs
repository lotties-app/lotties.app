using Lotties.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Lotties.Infrastructure.Tests;

public sealed class InfrastructureServiceCollectionExtensionsTests
{
    private static readonly DatabaseOptions Options = new("localhost", 5432, "model_tests", "user", "password");

    [Fact]
    public void AddInfrastructure_RegistersOptionsAndScopedDbContext()
    {
        using var provider = new ServiceCollection().AddInfrastructure(Options).BuildServiceProvider();
        using var scope = provider.CreateScope();

        var context = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();

        Assert.Same(Options, provider.GetRequiredService<DatabaseOptions>());
        Assert.NotNull(context.Model.FindEntityType(typeof(Domain.Events.Event)));
    }

    [Fact]
    public void AddInfrastructure_OpensTheDataContextOnTheControlContextsConnection()
    {
        using var provider = new ServiceCollection().AddInfrastructure(Options).BuildServiceProvider();
        using var scope = provider.CreateScope();
        using var otherScope = provider.CreateScope();

        var control = scope.ServiceProvider.GetRequiredService<LottiesDbContext>();
        var data = scope.ServiceProvider.GetRequiredService<LottiesDataDbContext>();

        Assert.Same(control.Database.GetDbConnection(), data.Database.GetDbConnection());
        Assert.NotSame(control.Database.GetDbConnection(), otherScope.ServiceProvider.GetRequiredService<LottiesDataDbContext>().Database.GetDbConnection());
        Assert.NotNull(data.Model.FindEntityType(typeof(Domain.Events.Event)));
        Assert.Null(data.Model.FindEntityType(typeof(Domain.Babies.Baby)));
    }

    [Fact]
    public void DesignTimeFactory_CreatesContextWithoutConnecting()
    {
        using var context = new LottiesDbContextFactory().CreateDbContext([]);

        Assert.NotNull(context.Model.FindEntityType(typeof(Domain.Events.Event)));
    }
}
