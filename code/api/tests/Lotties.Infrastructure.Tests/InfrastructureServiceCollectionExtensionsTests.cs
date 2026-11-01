using Lotties.Infrastructure.Persistence;
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
    public void DesignTimeFactory_CreatesContextWithoutConnecting()
    {
        using var context = new LottiesDbContextFactory().CreateDbContext([]);

        Assert.NotNull(context.Model.FindEntityType(typeof(Domain.Events.Event)));
    }
}
