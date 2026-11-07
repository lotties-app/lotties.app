using System.Data.Common;
using System.Reflection;
using Lotties.Application.Stores;
using Lotties.Domain.Stores;
using Lotties.Infrastructure.Persistence;
using Lotties.Infrastructure.Stores;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Lotties.Infrastructure.Tests.Stores;

/// <summary>
/// The wiring rules of the data store routing (docs/design/47-bring-your-own-database.md sections 3.6 and 12, task T2): nothing reaches
/// a data context except through the store scope, the data context is never pooled, and with the flag off the resolver reads nothing.
/// </summary>
public sealed class StoreRoutingRulesTests
{
    private static readonly DatabaseOptions Options = new("localhost", 5432, "model_tests", "user", "password");

    /// <summary>The only types that may receive a data context directly: the transaction wrapper gets the scope's built-in one.</summary>
    private static readonly Type[] AllowedDataContextHolders = [typeof(SharedTransaction)];

    [Fact]
    public void Infrastructure_NoTypeButTheAllowedOnesTakesADataContextInItsConstructor()
    {
        var holders = typeof(LottiesDataDbContext).Assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false } && !typeof(DbContext).IsAssignableFrom(type))
            .Where(type => type.GetConstructors(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                .Any(constructor => constructor.GetParameters().Any(parameter => parameter.ParameterType == typeof(LottiesDataDbContext))))
            .Except(AllowedDataContextHolders)
            .Select(type => type.FullName)
            .ToArray();

        Assert.Empty(holders);
    }

    [Fact]
    public void AddInfrastructure_RegistersAScopedStoreScopeAndAnUnpooledDataContext()
    {
        var services = new ServiceCollection().AddInfrastructure(Options);
        using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();
        using var other = provider.CreateScope();

        Assert.Same(scope.ServiceProvider.GetRequiredService<StoreScope>(), scope.ServiceProvider.GetRequiredService<IStoreScope>());
        Assert.NotSame(scope.ServiceProvider.GetRequiredService<IStoreScope>(), other.ServiceProvider.GetRequiredService<IStoreScope>());
        Assert.Equal(ServiceLifetime.Scoped, services.Single(service => service.ServiceType == typeof(LottiesDataDbContext)).Lifetime);
        Assert.DoesNotContain(services, service => service.ServiceType.IsGenericType
            && service.ServiceType.GetGenericArguments().Contains(typeof(LottiesDataDbContext))
            && service.ServiceType.Name.Contains("Pool", StringComparison.Ordinal));
        Assert.IsType<NoExternalDataStores>(provider.GetRequiredService<IExternalDataStores>());
        Assert.False(provider.GetRequiredService<IOptions<StoreRoutingOptions>>().Value.Enabled);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("false", false)]
    [InlineData("true", true)]
    public void AddDataStoreRouting_BindsStoresEnabled(string? value, bool expected)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(value is null ? [] : new Dictionary<string, string?> { ["Stores:Enabled"] = value })
            .Build();
        using var provider = new ServiceCollection().AddInfrastructure(Options).AddDataStoreRouting(configuration).BuildServiceProvider();

        Assert.Equal(expected, provider.GetRequiredService<IOptions<StoreRoutingOptions>>().Value.Enabled);
    }

    [Fact]
    public async Task ResolveForBabyAsync_FlagOff_IsTheBuiltInStoreAtEpochZeroWithoutAnyQuery()
    {
        var commands = new FailingCommands();
        var services = new ServiceCollection().AddInfrastructure(Options);
        services.ConfigureDbContext<LottiesDbContext>(options => options.AddInterceptors(commands));
        await using var provider = services.BuildServiceProvider();
        await using var scope = provider.CreateAsyncScope();

        var route = await scope.ServiceProvider.GetRequiredService<IStoreResolver>().ResolveForBabyAsync(Guid.NewGuid());

        Assert.Equal(StoreRoute.BuiltInDefault, route);
        Assert.Equal(0, commands.Count);
    }

    /// <summary>Fails every command, so a query the code under test should not run cannot reach a database.</summary>
    private sealed class FailingCommands : DbCommandInterceptor
    {
        public int Count { get; private set; }

        public override InterceptionResult<DbDataReader> ReaderExecuting(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result) => throw Fail();

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default) => throw Fail();

        private InvalidOperationException Fail()
        {
            Count++;
            return new InvalidOperationException("No query was expected.");
        }
    }
}
