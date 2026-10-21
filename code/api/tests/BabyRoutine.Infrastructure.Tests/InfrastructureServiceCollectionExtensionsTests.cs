using BabyRoutine.Infrastructure.Persistence;
using Microsoft.Extensions.DependencyInjection;

namespace BabyRoutine.Infrastructure.Tests;

public sealed class InfrastructureServiceCollectionExtensionsTests
{
    private static readonly DatabaseOptions Options = new("localhost", 5432, "model_tests", "user", "password");

    [Fact]
    public void AddInfrastructure_RegistersOptionsAndScopedDbContext()
    {
        using var provider = new ServiceCollection().AddInfrastructure(Options).BuildServiceProvider();
        using var scope = provider.CreateScope();

        var context = scope.ServiceProvider.GetRequiredService<BabyRoutineDbContext>();

        Assert.Same(Options, provider.GetRequiredService<DatabaseOptions>());
        Assert.NotNull(context.Model.FindEntityType(typeof(Domain.Events.Event)));
    }

    [Fact]
    public void DesignTimeFactory_CreatesContextWithoutConnecting()
    {
        using var context = new BabyRoutineDbContextFactory().CreateDbContext([]);

        Assert.NotNull(context.Model.FindEntityType(typeof(Domain.Events.Event)));
    }
}
